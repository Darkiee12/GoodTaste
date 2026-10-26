# PostgreSQL operating contract

**Baseline:** PostgreSQL 18 for the existing **local** `infra/compose.yaml`, not PostgreSQL 17. Production vendor/patch version is selected with documented compatibility and security review. No host port is published by default.

## Owners and privilege boundaries

- **PostgreSQL** is the source of truth for relational entities, constraints, account ownership, serving evidence, and object-storage metadata.
- **Flyway** is the only approved **schema migration runner**; it runs *before* the application deploys. `db/migrations/` owns the ordered SQL history.
- **Reylo** types domain SQL imports against the migrated dev/CI schema. Queries live in `src/modules/<domain>/server/repository/sql/`, never in the migrations folder.
- **Effect** manages server-side DB/transaction resources and typed failures, not schema migration execution.
- The **local Compose bootstrap account** currently performs migration and DB setup. **Production must separate** an appropriately scoped migration/DDL role from a restricted runtime application role. Neither role should be used from browser code or exposed through API responses.
- Domain owners propose schema changes. Agents must coordinate cross-domain FKs/constraints and not edit another module's private SQL.

See [the migration runbook](migrations.md) and [SQL-first persistence](../architecture/persistence.md).

## Local development

`postgres:18-alpine` runs inside the Docker Compose network. Its readiness probe uses `pg_isready`, and volume `postgres_data` stores data across container restarts. This configuration intentionally publishes **no** `5432` port to the host or internet.

From the repository root, after preparing `infra/.env`:

```bash
docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator validate
```

The migration directory can initially contain only its README while awaiting reviewed schema DDL. A successful empty migration run proves wiring only, **not** an application schema.

If you run Bun/TypeScript/Reylo **on the host**, `DATABASE_URL=postgres://...@localhost:5432/...` will not work with the unexposed Compose database. Use an explicitly reviewed loopback-only dev port mapping, network-local analysis runner, or another approved connection arrangement. Do not expose a publicly reachable Postgres endpoint just to make the IDE pass type checks.

## SQL integrity and tuning

- Use parameterized SQL, Postgres constraints, unique keys, foreign keys and transaction boundaries; avoid manual string-concatenated SQL.
- Queries should select only required columns, return deliberate nullability, use deterministic pagination ordering and enforce ownership for private data.
- Add or change indexes through reviewed Flyway migrations; inspect actual query plans and measure p95/p99 and lock behavior when optimizing. Writing raw SQL is not automatically the fastest plan.
- Prefer short transactions. A cross-domain atomic workflow shares one pinned transaction client, coordinated under `src/server/database/`.
- Avoid running network AI/provider calls inside an open DB transaction.

## Migration safety

A checked-in versioned Flyway migration is immutable once applied to a persistent environment. Use new forward migrations, never silent rewrites or production `db push`. Flyway verifies migrations through its `flyway_schema_history` checksums.

Any destructive or long-running migration needs an impact assessment, DB backup/restore strategy, backwards-compatible rollout, lock/timeout assessment and human approval. Do not apply `repair`, `clean`, a database reset, `DROP` or volume deletion as a troubleshooting shortcut.

## Backups and recovery

Production requires automated encrypted/offsite backups, retention and regular **tested** restores. Select and document RPO/RTO with the production database provider. A volume snapshot alone is not proof of restoration. The Flyway schema history is part of the database backup. Before a production DDL rollout, confirm the backup recovery point.

Recovery principles: stop application rollout on migration failure; inspect Flyway logs and transaction state; restore the migration source if an applied file was accidentally modified; write a reviewed forward fix. Do not rewrite history or silently change checksums.

## Verification

- `pg_isready` / read-only `SELECT 1` confirm availability, not schema compatibility.
- `flyway info`, `migrate`, `validate` confirm schema-history state.
- Reylo type checks confirm SQL statements align with the migrated schema when a direct DB connection is available.
- Integration tests cover auth isolation, constraints, transactional rollback, concurrent updates and evidence provenance.

See [database test plan](../development/database-testing.md) and [local operations](operations.md).
