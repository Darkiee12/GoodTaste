# SQL-first persistence with Reylo and Effect v4

**Authoritative design rule.** FeastJourney uses PostgreSQL as its relational source of truth, **Flyway** for schema migrations, **Reylo** for typed application SQL, **Effect** for application operations/dependency lifetimes and **Zod 4.6** for network input. These tools solve different problems. No Prisma/Drizzle schema DSL, Kysely query builder, or ORM should be added merely for migration management.

## Canonical paths

```text
db/migrations/                                        # Flyway only, global ordered history
src/server/database/                                 # Pool, transactions, Effect Layer/Context
src/modules/user/server/repository/sql/               # Member/profile persistence
src/modules/food-discovery/server/repository/sql/     # Food catalog and discovery queries
src/modules/restaurant-discovery/server/repository/sql/ # Venues, menus, serving evidence
src/modules/<domain>/server/operations/               # Effect application use cases
src/modules/<domain>/server/index.ts                  # Deliberate server-only exports
src/server/workflows/                                # Cross-domain application orchestration
```

A file under `db/migrations/` can contain multiple DDL statements and is **never** imported into TypeScript. A file under a domain's `repository/sql/` contains **one** SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES/TABLE statement. Reylo compiles/analyses it and exposes a typed `.run()` method.

Do not create `repository.ts`, `service.ts`, `controller.ts`, a `queries/index.ts` barrel or a `services/` directory for ceremony. Choose the smallest source-level abstraction that protects a real contract.

## Practical use-case flow

```text
TanStack Start createServerFn / external API route (HTTP)
  ↳ Zod 4.6 validation + server-trusted actor + policy
  ↳ Effect operation (named behavior, typed errors)
    ↳ optional domain repository boundary (if useful)
      ↳ Reylo .sql module using the injected DB client
    ↳ optional one-way public operation from another module
  ↳ client-safe response
```

Think of “Controller → Service → Repository” as *responsibilities*, not mandatory classes/layers:
- Controller = server-function/HTTP adapter.
- Service/use case = `Effect` operation.
- Repository = persistence functions when they hide real state transitions/query selection or provide a meaningful seam.
- Dependency injection = `Context.Service` / `Layer` only for true capabilities, resources, or justified test replacement.
- SQL = query definition and optimized relational work, colocated with the owning domain.

Application operations may call Reylo query modules directly when no additional repository layer is justified. Do **not** make HTTP handlers import the query or a DB pool: keep an application boundary even for simple public reads.

## Query design and results

Example illustrative query, **not a migration or established schema**:

```sql
-- src/modules/restaurant-discovery/server/repository/sql/find-by-id.sql
SELECT
    id,
    name,
    address
FROM restaurants
WHERE id = :id::uuid;
```

Example illustrative usage:

```ts
import findById from "./sql/find-by-id.sql";

const restaurant = await findById.run(db, { id });
```

Here `db` is a Reylo-supported client or pool acquired from the server-only database capability. Reylo's inferred output may be a single row or `null` if the query's key/cardinality can be proven; do not assert a shape blindly. Postgres `BIGINT` maps to `bigint`, exact `NUMERIC` to a string, and timestamps to ISO strings: do not overwrite these representations with hand-written `Date`/`number` row types. Add domain conversion only when the application needs a different semantic type.

- Parameterize **values**; never concatenate request-controlled SQL. Identifiers and dynamic ordering are not value parameters: use a reviewed allowlist / explicit query variants.
- Select only needed columns; apply LIMIT and stable ordering for pagination; evaluate `EXPLAIN (ANALYZE, BUFFERS)` on representative non-sensitive development data when performance matters.
- **Reylo is the authoritative source for query result shapes and cardinality.** Do not duplicate inferred rows as hand-written `Record`/`Summary`/DTO types or create mechanical `toX()` functions. Prefer separate purpose-specific SQL queries (including `::text` projections for JSON-facing `BIGINT` identifiers) to fetching broad records and removing fields later. SQL projection and authorization are the reviewed exposure controls; static TypeScript annotations do not strip properties at runtime.
- A genuinely independent domain invariant or stable external response contract can justify its own type/codec, but not a redundant mirror of a Reylo result. Follow the concrete [code-style rules](../development/code-style.md#9-reylo-owns-query-result-types-reject-mirror-dtos-and-mechanical-mappers).
- Indexes are part of Flyway DDL, not dynamically created by query code.
- Database `NOT NULL`, `UNIQUE`, FKs and `CHECK` constraints enforce integrity. Typed SQL reduces manual type drift, but is **not** a runtime guarantee that an AI-derived food claim is accurate.
- Distinguish “not found”/zero affected rows from connection errors. Use stable typed application errors, not driver-text matching.

## Live schema requirements

Reylo is a TypeScript 7.1 content mapper. Its type check prepares each query using its own direct connection to the **migrated development database**; it does not run side-effecting query statements to infer types. It reads `DATABASE_URL` by default or a `direct_url` in `.reylo.yaml`; avoid transaction-mode PgBouncer for that compile-time connection. Application runtime may use a different supported driver/pool, but their schemas must match.

This repository already has `reylo/vite`, `@reylosql/postgres`, a content-mapper TypeScript setting, and `tsc --noEmit --runExternalCode`; agents must keep those aligned when scaffolding application code.

- Local dev: migrations run → development database is reachable → `bun run check-types`/build.
- CI: provision fresh database → migrate → validate → configure **direct** analysis connection → typecheck all SQL imports → run integration tests/build.
- No `.sql` imports yet means the existing static CI run does not prove a working Reylo database integration.
- Reylo's `.reylo/` is a **cache**, not a migration record or schema source of truth. A build may use cached analysis when DB is unavailable, so CI must explicitly ensure migrations and database connectivity before asserting query correctness.
- Do not invent a custom Reylo code-generation workflow; the SQL file is the source and Reylo works through the configured TS mapper/runtime loader.

## Transactions and Effect

All driver execution goes through `runQuery` in `src/server/database/query.ts`,
which resolves the ambient client (the transaction connection inside
`withTransaction`, the pool otherwise), preserves Reylo's inferred result
type, and maps rejections to typed failures by SQLSTATE/driver code. See the
[code style guide](../development/code-style.md) for the boundary, the error
taxonomy, and the retry policy; this section states the transaction rules.

A transaction must pin one physical database connection. `withTransaction` in
`src/server/database/client.ts` owns acquisition/commit/rollback/release and
supplies the transaction-bound Reylo-compatible client to participating SQL
operations (resolved via `currentSql`). With an Effect implementation, bracket
the resource (acquire/use/release) with the **current** Effect v4 API in
`repos/effect/LLMS.md` and current package source; do not handwrite an unverified v3 tutorial pattern.

- A failed `BEGIN` releases the reservation before the attempt fails; a
  failed `COMMIT` still releases; a failed `ROLLBACK` can never mask the
  original failure and the release is still attempted; a failed release on
  the success path surfaces instead of a silent success. Release runs as an
  uninterruptible finalizer.
- Owner-membership changes serialize on a guard row (`SELECT ... FOR UPDATE`
  on the owner role) taken inside the transaction before counting; see
  `access-control.md`. Every new account receives `member` through an
  `AFTER INSERT` trigger in the user-insert transaction (migration `V009`).
- A coordinator in `src/server/workflows/` owns cross-domain atomic changes; a participating repository must use the supplied transaction client, not borrow a new pool connection.
- Only serialization conflicts and deadlocks retry, and only at the transaction boundary with a bounded budget (see the [code style guide](../development/code-style.md)). Do not retry non-idempotent writes, constraint violations, or connection loss, and do not repeat a failed transaction without understanding whether it committed.
- Do not run unrelated external AI/network effects while holding a DB transaction open. Obtain outside-DB inputs first, then perform short, well-bounded updates with conflict/idempotency checks.
- Beware parallel requests using the same transaction connection concurrently. Serialize DB statements unless the chosen driver and transaction design explicitly support a concurrency pattern.
- Log failures with request correlation but never raw credentials, SQL parameters that contain private data, or production URLs with embedded passwords.

## Geographic queries

Implemented Restaurant Discovery uses purpose-specific area, name, dish,
currency-candidate, local-range, menu and administration SQL. Database views
centralize eligible serving evidence and authoritative displayed-price selection;
search still checks publication through Food's public operation. Exact decimal
strings remain NUMERIC through budget multiplication and are never converted to
JavaScript Number. Expiring token-owned FX refresh leases are acquired/released
with individual statements; provider HTTP runs outside transactions. See
[Restaurant Discovery](restaurant-discovery.md).

PostGIS 3.6 in PostgreSQL 18 handles Restaurant Discovery radius and bounding-box queries through domain-owned Reylo SQL. Prefer `geography(Point,4326)` + GiST, use `ST_DWithin` for index-aware filtering and select scalar distances rather than raw geography payloads. Long/lat/radius are bounded by Zod at the HTTP adapter. MapLibre renders results only; it is not the geographic search service. See [maps](maps.md).

## Domain trust and access

A guest or member is represented by a trusted Effect `Data.TaggedEnum` actor; its per-request service must not be cached in a shared runtime. A guest can use public discovery reads; a member's saved data must be queried with actor-scoped predicates (e.g. `WHERE owner_id = :actorId`) and ownership checks. The `user` module owns identity/user preferences; Food Discovery owns dish identity; Restaurant Discovery owns venue-to-food offering evidence. No module imports another module's private SQL.

Input parsing belongs at HTTP/AI/external-provider trust boundaries; do not introduce duplicate Zod row validators just because Reylo returns a row. Domain invariants still need checks and safe output serialization.

## Private scan persistence

Private scan JSONB is decoded as a versioned external document at the actual AI/customer trust boundary. It does not replace relational menu tables. Model and new customer draft IDs are assigned by the server. Revisions append under an expected-revision check; submitted revisions are fixed snapshots. Cleanup deletes expired private JSON and bytes while retaining minimal consent/review attribution and approved relational facts. Single-row inserts use a provable single `VALUES` row; callers do not normalize Reylo arrays into rows.

## References

- https://reylo.dev/#sql
- https://reylo.dev/postgres/
- https://effect.website/docs/v4/runtime
- https://effect.website/docs/v4/requirements-management/services
- [Migration and release policy](../infra/migrations.md)
- [Access control](access-control.md)
