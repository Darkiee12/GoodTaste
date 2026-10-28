# Code style: clarity and type-driven programming

Canonical patterns enforced in this repo. Each rule shows a real before/after
from `src/`. When a rule and a situation conflict, fix the contract (the SQL,
the schema, the type) instead of normalizing around it.

## 1. Trust Reylo cardinality — never normalize `Row | Row[]`

Reylo infers one materialization per query (`repos/reylo` contract
`Materialize<Row, C>`: `"many"` → `Row[]`, `"one"` → `Row`,
`"maybeOne"` → `Row | null`, `"none"` → `void`). There is no `Row | Row[]`
union. A `toArray`/`isReadonlyArray`/`normalizeRows` helper therefore turns
three distinct contracts into one shape and hides which one the SQL promises.

Before (`src/modules/food-discovery/server/repository/dish-repository.ts`):

```ts
const toArray = <Row>(value: Row | ReadonlyArray<Row>): Array<Row> =>
  isReadonlyArray(value) ? [...value] : [value];

// "many" query: pointless copy of an already-array result
return toArray(rows).map((row) => row.id);

// "one" query via .try(): wraps a single row, then checks an impossible state
const created = toArray(outcome.value);
const first = created[0];
if (first === undefined) {
  return yield* new PersistenceError({ operation: "dish/insert", cause: "insert returned no row" });
}
return toRecord(first);
```

After:

```ts
// "many": the array is already the contract
return rows.map((row) => row.id);

// "one": a successful INSERT ... RETURNING yields exactly one row
return toRecord(outcome.value);

// "maybeOne": null is the only other case, and it is legitimate
return outcome.value === null ? null : toRecord(outcome.value);
```

Rules:

- Probe the inferred type before touching a call site
  (`DATABASE_URL=... bunx tsc --noEmit --runExternalCode` is the authority;
  the `.reylo/` cache records each query's cardinality).
- If the shape is wrong, fix the SQL, not the wrapper. Example:
  `place-find-by-iso.sql` returned unordered-many rows for a single-place
  contract; the fix was `ORDER BY id ASC LIMIT 1` (cardinality becomes
  `maybeOne`), not a `rows[0] ?? null` normalization.
- Keep legitimate absent-record handling: `row === null ? null : ...` on
  `maybeOne` queries stays.

## 2. One database execution boundary: `runQuery`

All driver execution goes through
`src/server/database/query.ts`:

```ts
export const runQuery = <A>(
  operation: string,
  task: (sql: DbClient) => Promise<A>,
): Effect.Effect<A, DatabaseError, Database> =>
  Effect.flatMap(currentSql, (sql) =>
    Effect.tryPromise({
      try: () => task(sql),
      catch: (cause) => classifyDatabaseError(operation, cause),
    }),
  );
```

- The thunk runs lazily (once per execution) and receives the ambient client:
  the transaction connection inside `withTransaction`, the pool otherwise.
  Never acquire a different connection inside a transaction.
- Inferred Reylo types flow through untouched (`Row[]`, `Row | null`, `Row`,
  `void`); call sites add no casts.
- Driver rejections map to typed failures via `classifyDatabaseError`.
  Post-query mapping stays outside: pass only the driver promise, never domain
  logic, into `runQuery`.
- No per-query logging, no extra DI layers. Do not wrap `runQuery` in another
  helper unless it protects a new contract.

Rejected alternative: a pure-promise wrapper where each call site acquires the
client first (`const sql = yield* currentSql; ...`). That duplicates the
acquire at 60+ call sites and lets one site silently bypass an open
transaction. Routing belongs in one place.

## 3. Classify failures by code, never by message

`src/server/database/errors.ts` owns the taxonomy. `PostgresError.code` is the
SQLSTATE; driver teardown carries codes (`ECONNREFUSED`, `CONNECTION_CLOSED`);
old message matching (`includes("too many clients")`, `"Connection
terminated"`) is gone:

| Code | Failure | Meaning |
| --- | --- | --- |
| `08xxx`, `53300`, socket/driver codes | `DatabaseUnavailable` | Transient; safe to surface as 503 |
| `23505` | `PersistenceConflict` | Keeps the server `constraint_name` |
| `40001`, `40P01` | `TransactionConflict` | Aborted before commit; retryable (see §4) |
| anything else | `PersistenceError` | Bug or bad SQL; keeps the rendered `cause` |

`cause` stays a string for logs and debugging; what clients may see is decided
separately in `src/server/http/api-error.ts`. `TransactionConflict` maps to
503 like other transient failures.

A deprecated code-based `isConnectionFailure` shim remains only for in-flight
callers migrating to `runQuery`; do not add new uses.

## 4. Bounded retry lives only at the transaction boundary

`withTransaction` (`src/server/database/client.ts`) retries the whole
acquire/use/release attempt with Effect v4 native retry:

```ts
return Effect.retry(attempt, {
  while: (error) => error instanceof TransactionConflict,
  times: 2,
  schedule: Schedule.exponential("100 millis"),
});
```

- Each attempt reserves a fresh connection and issues a new BEGIN (the aborted
  transaction must be released; rollback runs on the failure path).
- Only `TransactionConflict` retries. Constraint violations, invalid SQL, and
  connection loss fail immediately. Interruptions never retry (retry observes
  typed failures only) and still release the connection.
- Single statements outside a transaction never retry. Never retry
  non-idempotent writes or repeat a failed transaction without knowing whether
  it committed.

Exact v4 APIs used: `Effect.retry` with `Retry.Options` (`while` predicate +
`times` + `schedule`), `Schedule.exponential`, `Effect.acquireUseRelease`,
`Effect.tryPromise`. Note v4 removals: there is no `Effect.catchAll`
(prefer `Effect.catchIf`/`catchTags` or `Effect.flip` in tests), no
unscoped `Effect.fork` (use `forkDetach`/`forkScoped`), and no
`Exit.isInterrupted` (use `Cause.hasInterruptsOnly` on a failed exit).

## 5. Keep type-required `??` and `?.` — remove the rest

`??`/`?.` are required wherever the type says so and forbidden where it does
not (`typescript/no-unnecessary-condition` enforces both directions). Kept:

```ts
namesByDish.get(key) ?? [];            // ReadonlyMap.get returns T | undefined
parsed.error.issues[0]?.message ?? "Invalid request body."; // noUncheckedIndexedAccess
cursor?.updated ?? FAR_FUTURE;         // cursor is T | null
input.locale ?? "en";                  // optional input field
```

Removed:

```ts
// NonEmptyArray guarantees [0]; the fallback hid that guarantee.
record.names[0]?.name ?? "dish"  →  record.names[0].name

// "" is never a map key; the lookup could only miss.
page[page.length - 1]?.toString() ?? ""  →  explicit lastId/lastRecord branches
```

Use `ReadonlyMap<K, V>` for application maps and handle absent keys
explicitly (`??` with a real default). The `src/shared/i18n.ts` locale maps
keep their `?? english` fallbacks because `Map.get` genuinely returns
`T | undefined`; that explicit handling is the pattern, not a violation.

## 6. Branches over nested ternaries; no fallback expressions

`no-nested-ternary` is an error. Simple ternaries stay only when they read
better than branches. Validation, permissions, and business rules use
explicit `if`/`return`:

```ts
// yes
if (record === null) {
  return yield* new DishNotFound({ dishId });
}

// no: fallback that hides a broken invariant
const name = value || "default";
```

## 7. No one-line renames, no dead bindings

Removed from this repo:

- `validateLocaleTag = (locale) => isLanguageTag(locale)` — a rename with
  zero call sites.
- `dishRecordId = (record) => encodeDbId(record.id)` — a rename with zero
  call sites.
- `const config = yield* appConfig; void config;` and
  `let parentId ...; void parentId;` — bindings kept alive with `void` to
  silence unused warnings. Require only what is used; destructure only what
  is read (`const { errors } = yield* resolveX(...)`).

Kept, because they encode a real contract rather than renaming stdlib:

- `toPrefixKey`/`toContainsKey` — SQL `LIKE` pattern construction shared by
  every search path.
- `asLocalizedName` — snake_case DB row → camelCase domain boundary.
- `groupByDish`, `clampLimit`, `checkLocale` — multi-use or validation logic.
- `describeCause` — one rendering of unknown throwables for all typed
  failures.

Centralize only where a second use case or an external boundary exists; do
not replace one unnecessary abstraction with another. Trivial stable
duplication (`checkLocale` in two services) stays duplicated until a third
use or a shared contract appears.

## 8. Never wrap a library's internals as an application dependency

Do not introduce an application-owned client, instance, or wrapper merely
because a library uses that mechanism internally. The test is the library's
**public API**: if it accepts the simpler input directly, pass it directly.

Removed from this repo: an application-owned `Kysely` instance built solely
to hand to Better Auth. The official PostgreSQL integration accepts a plain
`pg.Pool`, and the non-default schema is selected with the documented
`search_path` connection option — so the application owns one small pool
factory (`createAuthPool`) and no Kysely import, instance, or lifecycle.
Better Auth still uses Kysely internally; that is the maintainer's concern,
not ours.

Before adding a database client, ORM, query builder, or wrapper, verify
against the installed types and the official docs:

1. Inspect the library's public configuration surface first.
2. Use the smallest supported integration (a `pg.Pool`, not a Kysely
   instance constructed just to wrap that pool).
3. Check schema/namespace selection, connection limits, and shutdown behavior.
4. Confirm codegen tooling still works against the chosen integration.
5. Prove schema routing with a test (e.g. same-named decoy tables in
   `public` that must stay untouched).

## 9. What the linter enforces

`.oxlintrc.json` (oxlint 1.85.0): `no-nested-ternary`,
`typescript/no-unnecessary-condition`, `typescript/no-explicit-any`,
`typescript/no-non-null-assertion`, plus the local `anti-slop` rules. Verified
against the installed version — `bunx oxlint` has no `--rules` flag, so rule
existence is proven by a clean `bun run lint` with `--max-warnings 0`.
