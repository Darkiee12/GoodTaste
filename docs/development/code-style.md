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

## 9. Reylo owns query result types; reject mirror DTOs and mechanical mappers

**MUST:** derive database result types from the particular Reylo `.sql` query,
not a manually maintained `*Record`, `*Row`, `*Summary` or `*Dto`
interface with the same fields. The migrated PostgreSQL schema, the SQL
projection, and Reylo's inferred result/cardinality are the persistence
contract. Query-specific inferred type aliases are fine when they clarify a
public service signature:

```ts
import profileByUserId from "@/modules/user/server/repository/sql/profile-by-user-id.sql";

export type ProfileRow = (typeof profileByUserId)["~reylo"]["element"];
```

The alias above refers to Reylo's inference; it does **not** copy columns into
another structural declaration. A separately owned domain type is justified
only for an actual invariant, semantic conversion, versioned external contract,
or untrusted boundary, not because an ORM-style entity-to-DTO pipeline is
familiar.

Rejected pattern (these two declarations and the mapper add no behavior):

```ts
interface ProfileRecord {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly locale: string;
}
interface ProfileSummary {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly locale: string;
}
const toProfileSummary = (row: ProfileRecord): ProfileSummary => ({
  user_id: row.user_id,
  display_name: row.display_name,
  locale: row.locale,
});
```

**MUST NOT:** insert `toProfileSummary`, `toFavoriteSummary`, spreads,
`Pick`/`Omit` or an identical interface solely to copy/rename a query result
into a supposedly client-safe type. TypeScript structural assignability does
not remove extra properties at runtime, so calling an identical type a
"reviewed boundary" is not a security measure.

Instead, select exactly the approved fields in SQL and return the inferred
result through the authorized operation. Review the query and authorization
predicates as the security boundary; do not serialize whole rows and assume a
TypeScript annotation strips hidden columns.

## 10. Shape the result in SQL rather than fetching and removing fields

**MUST:** write purpose-specific SQL for the consumer. We can maintain multiple
queries for the same tables. There is no requirement to fetch an entire entity
or reuse a broad entity query and then project it in TypeScript merely because
an ORM would do that. SQL owns column selection, joins, filtering, sorting,
aggregation and pagination; Reylo owns the resulting TypeScript type.

Example: the settings page needs only three profile fields:

```sql
SELECT user_id, display_name, locale
FROM feastjourney.user_profiles
WHERE user_id = :user_id;
```

No `ProfileRecord -> ProfileSummary` stage is needed. Similarly, when the
**transport** needs a decimal-string dish ID rather than Reylo's inferred
`bigint`, project that representation explicitly:

```sql
SELECT dish_id::text AS dish_id, created_at
FROM feastjourney.favorites
WHERE user_id = :user_id
ORDER BY created_at DESC
LIMIT :limit;
```

For insert responses, use `RETURNING dish_id::text AS dish_id, created_at`
when the *same query's consumer* requires strings. This is a real
representation change; prefer handling it once at the query/boundary rather
than scattering `.toString()` mappers through handlers. Keep the stored
column and predicates as their native types; a transport projection is not a
reason to cast indexed `WHERE` columns. If the same operation is consumed
internally and externally with different needs, keep those contracts explicit
rather than forcing one lossy shape on every caller.

These rules do **not** remove runtime validation of untrusted HTTP inputs,
authorization, domain invariants, safe error encoding or deliberately versioned
public API contracts. The current HTTP input validator is Zod 4.6; use Effect
Schema for genuine Effect-native codecs where justified. If a response requires
an explicit runtime encoder or redaction, do that intentionally, rather than
claiming that a type alias provides runtime filtering. Do not create an N+1
query pattern just to avoid an application-level transformation; query design
still needs sound performance.

## 11. Prefer same-name type/value companions for real domain operations

TypeScript has separate **type** and **value** namespaces. A `type` (or an
`interface`) and a `const` can intentionally share a name: we do not need a
`ProfileSchema`/ `Profile` split or an identical interface solely to
work around a nonexistent naming collision.

For an Effect Schema that is itself the useful runtime API, keep it simple:

```ts
export const DishId = Schema.String.pipe(Schema.brand("DishId"));
export type DishId = typeof DishId.Type;
```

When a **domain concept actually has meaningful behavior**, prefer a
companion-value API (`Permission.from(value)`, `RoleId.parse(value)`,
`AccessControl.create(input)`) instead of scattered
`toPermission(value)`, `parseRoleId(value)`, or
`createAccessControl(input)` standalone functions.

An example of a meaningful branded-value companion:

```ts
import { Brand } from "effect";
import { z } from "zod";

export type Permission = string & Brand.Brand<"Permission">;

const permissionBrand = Brand.nominal<Permission>();
const permissionSchema = z.string().min(1);

export const Permission = {
  // For already-trusted or already-validated values only.
  from: (value: string): Permission => permissionBrand(value),
  // For untrusted boundary input.
  parse: (value: unknown): Permission =>
    permissionBrand(permissionSchema.parse(value)),
} as const;
```

`from` is a semantic conversion, **not** a license to bypass validation at
trust boundaries. `parse` validates unknown input; `create` establishes real
construction invariants. Avoid adding these methods when no conversion or
invariant exists. Do not attach arbitrary `.from()` methods to third-party
Schema objects or invent a class/interface just to make the syntax work.

An exception to the companion preference is a generic, cross-cutting utility
whose operation does not naturally belong to one domain type. Keep those
functions direct; eliminate ceremony, not useful functional composition.

## 12. What the linter enforces

`.oxlintrc.json` (oxlint 1.85.0): `no-nested-ternary`,
`typescript/no-unnecessary-condition`, `typescript/no-explicit-any`,
`typescript/no-non-null-assertion`, plus the local `anti-slop` rules. Verified
against the installed version — `bunx oxlint` has no `--rules` flag, so rule
existence is proven by a clean `bun run lint` with `--max-warnings 0`.

## 10. Security invariants are implementation rules, not aspirations

The following are mandatory engineering constraints. A passing test or a
documented guarantee is meaningless if the setup or the handler bypasses
the invariant it claims.

- Authentication and authorization have one authoritative boundary each:
  the session resolver builds the request-scoped Actor from the verified
  session, and the authorization service evaluates current database grants.
  Never promote a credential (API key, header, cookie) into an identity
  without an explicit identity and permission policy.
- Never serialize bearer credentials (session tokens, OAuth access/refresh
  tokens, reset tokens) into browser application data. List and revoke
  sessions by non-authenticating record references; resolve tokens
  server-side after an ownership check.
- Never verify a security invariant in a test by manually establishing that
  invariant. Register through the real handler, then assert the persisted
  state. A test that manufactures its own premise proves nothing.
- Destructive tests operate only on proven disposable resources. Never
  drop shared objects whose creation the test did not establish; record
  pre-existence and clean up only owned fixtures.
- Protect read-check-write invariants with transaction isolation or locks
  (`SELECT ... FOR UPDATE`, advisory locks), counted and mutated inside one
  transaction across every replica. A bare transaction without locking does
  not fix a time-of-check/time-of-use race.
- Use Effect's typed failure channels (`Effect.tryPromise` at adapter
  boundaries, typed `Data.TaggedError`s, `acquireUseRelease` finalizers).
  Never map an unavailable authorization database to an empty grant set,
  never demote a provider outage to an anonymous guest on a protected path,
  and never swallow audit-insert failures for mandatory records.
- Audit privileged database mutations atomically with the mutation, in the
  same transaction. Event/telemetry audit stays best-effort and never gates
  access.
- Prefer source-derived types (Reylo cardinality, vocabulary-derived
  permission requests) and existing library contracts over wrappers. No
  giant positional import tuples shared across unrelated handlers; each
  handler destructures only the namespaces it uses.
