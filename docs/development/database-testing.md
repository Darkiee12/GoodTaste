# Database and migration verification

## Layers of evidence

| Check | What it establishes | What it does **not** establish |
| --- | --- | --- |
| `docker compose ... config --quiet` | Compose config interpolates/parses | Image exists, Postgres starts, Flyway works |
| Flyway `migrate` on **fresh Postgres 18** | Ordered schema can be installed | App queries are semantically correct |
| Flyway `validate` | Recorded versions/names/checksums consistent | Safe data changes or query performance |
| Re-run Flyway `migrate` | Pending versioned migrations settle to no-op | Repeatable migrations always harmless |
| Reylo TypeScript check | Query and inferred row types fit the migrated schema | AI facts or user ownership are correct |
| PostgreSQL integration tests | Transaction behavior, constraints, query results | Production concurrency/performance automatically proven |
| App build + browser checks | Bundling and user flows | Migrations and operations safe on existing production data |

## Required test scenarios when schema/code arrives

1. Fresh-database migration: migrate all files in one order, validate, and record schema-history versions.
2. Upgrade-path test: start from previous deployed schema and verify migrations apply without deleting user data or breaking older deployed readers during rollout.
3. Query shape and invariants: PK/unique nullability, missing rows, foreign keys, under/over-limit pagination, Unicode food names, source/evidence nullability.
4. Actor access: guest public discovery works; private tables reject guest reads/writes; member A cannot access member B's saved items, including through bulk operations.
5. Transactionality: one cross-domain change succeeds atomically, failing the second step leaves no partial commit; pool client is released on error/interruption.
6. Concurrency: duplicate saves/idempotency, competing updates, and uniqueness violations have defined outcomes.
7. Negative provider cases: untrusted menu/AI output cannot become confirmed ingredient or restaurant-offering facts; SQL typing alone does not cover this.
8. Migration evolution: checksum mismatch rejects changed applied migration; destructive/long-running changes include rollback/compatibility approval.

## CI sequencing

The `Quality` workflow initially checks static formatting/lint/types without a database because the feature SQL is not yet implemented. The separate database job can prove the Flyway/PG migration pipeline.

**Before the first module SQL import merges:** CI must run a migrated PostgreSQL instance and configure `DATABASE_URL` (direct connection) for Reylo's type checker and production build. It must fail if the DB is unavailable or the migration isn't applied. Disallow green builds based solely on `.reylo/` cache.

Keep database test fixtures synthetic and disposable; never use user photographs, real account tokens or production credentials. Use PostgreSQL for query tests rather than mocking SQL semantics.

## Developer loop

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator validate
# Connect the host-side Reylo type checker to a dev-only database endpoint.
bun run check-types
```

The Compose network deliberately exposes **no PostgreSQL port to the host**. Until an intentional loopback-only forwarding strategy or a containerized typecheck is implemented, running `bun run check-types` directly on the host with live `.sql` imports requires explicit access to the database; do not promise it will work by default. Document the chosen access mechanism with the application scaffold.

This document describes **required scenarios**, not an already-implemented or passing test suite.
