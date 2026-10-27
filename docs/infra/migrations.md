# Flyway migrations and deployment lifecycle

**Status: authoritative decision and operational contract.** GoodTaste uses PostgreSQL 18, SQL-first migration files, and Flyway's standalone CLI/container. Bun, Reylo, Effect, and TanStack Start do **not** execute schema migrations as part of the application startup.

## Ownership and directory layout

```text
db/migrations/
  README.md
  V<version>__<description>.sql        # Written only after schema review
  R__<description>.sql                 # Optional repeatable objects
src/modules/<domain>/server/repository/sql/
  <query-name>.sql                      # Reylo application queries; never migrations
src/server/database/
  ...                                   # Runtime pool and transaction support; no Flyway
infra/compose.yaml                     # Local PostgreSQL + one-shot migrator
```

**PostGIS + schema ownership:** `V20261027_001__enable_postgis.sql` records the extension prerequisite. The PostGIS image initializes extension objects in `public`, which can make Flyway reject a first migration in that nonempty schema. Use `FLYWAY_SCHEMAS=goodtaste` and `FLYWAY_DEFAULT_SCHEMA=goodtaste` for a fresh app schema/history, keeping `baselineOnMigrate=false`. All future GoodTaste app tables must be placed in `goodtaste` explicitly or via a deliberately configured DB search path. Production/managed Postgres may require DBA provision of the extension. The PostGIS image currently supports AMD64; document host compatibility before running locally.

The database-wide schema history is centralized; *query ownership* stays with User, Food Discovery or Restaurant Discovery. A cross-domain foreign key may need coordinated review, but it still appears in the single ordered Flyway migration stream.

Flyway stores version, checksum, outcome and timestamp in `flyway_schema_history`. A versioned SQL script is applied once. Never silently edit or renumber an already-applied migration; write a new forward migration. Repeatable scripts rerun when their checksum changes: keep them idempotent and reserve them for views/functions or other appropriate objects.

## File naming and review

- Use a chronological, collision-resistant version ID: `V20261027_001__create_user_accounts.sql`, `V20261027_002__create_food_catalog.sql`; review any concurrent same-day numbering conflict *before* merge. These names are examples, not committed schema decisions.
- Use `UPPERCASE` SQL keywords, explicit constraints (`NOT NULL`, `UNIQUE`, `CHECK`, `FOREIGN KEY`) and descriptive index names. Favor PostgreSQL-native datatypes and a stable naming convention.
- All DDL should be safe on a **fresh database** and on a database at the previous released version. Do not rely on developer-local state.
- Author schema ownership and affected consumer query changes in the PR. Every table belongs to a documented domain; shared cross-domain relations need coordination.
- Prefer PostgreSQL's transactional DDL. Special operations requiring `executeInTransaction=false`, such as concurrent index creation, require a separate reviewed migration with appropriate lock/rollback analysis.
- Avoid destructive changes during a release where an older app version may still be running; use expand → backfill → deploy readers/writers → contract. Keep rollbacks focused on application code where compatible rather than assuming an automatic `down` migration exists.
- Do not use `baselineOnMigrate`, `outOfOrder`, `clean` or `repair` as routine recovery. `clean` is disabled by local config. `repair` changes Flyway's recorded history and needs explicit reviewer/operator approval.

## Local startup order (Docker Compose)

`infra/compose.yaml` contains a `postgres` service with a health check and a **one-shot `migrator`** service (`flyway/flyway:13.11.1`) whose SQL directory is mounted read-only:

```text
postgres starts → postgres becomes healthy → migrator runs migrate → exits 0
                                                         |
                                                         v
                                    future GoodTaste app service may start
```

A future application service in this **local Compose** file must declare:

```yaml
depends_on:
  migrator:
    condition: service_completed_successfully
```

Do not introduce a fictitious app service solely for dependency wiring; the current scaffold has not chosen its container/image. `service_completed_successfully` is an **orchestration prerequisite in Docker Compose**, not a replacement for production deployment gates or runtime database error handling. A failed migration must block app startup.

The local example deliberately uses the same bootstrap PostgreSQL credentials for Flyway as for the existing Postgres container. **Production must use separate credentials**: migration role with narrowly scoped DDL/ownership rights, app role with only needed DML/USAGE rights, no SUPERUSER and no ability to drop the database. Decide role-ownership/grant strategy before the first production migration; do not embed privileges/secrets in client-side modules.

## Local commands (repo root)

Set up local-only credentials first; never paste the rendered config with secrets into tickets or public logs.

```bash
cp infra/.env.example infra/.env
docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator validate
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator info
```

The `run --rm migrator` command uses Compose's declared `migrate` command; `validate` and `info` override it. `up -d` without selecting services also starts Garage and triggers the migrator; the example uses an explicit invocation to make migration status unambiguous. A zero exit code is required. Re-running `migrate` without new versioned files should be idempotent.

To inspect problems, use `docker compose ... logs migrator` for the normal `up` lifecycle or run the one-shot command in the foreground. Mask credentials and connection strings in shared logs. Do not remove the Postgres volume to recover a failed migration.

## CI: schema-first SQL verification

CI should provision a fresh, disposable PostgreSQL 18 instance, run **all** migrations in version order, run Flyway `validate`, then type-check Reylo `.sql` imports against the migrated schema and run repository integration tests. Running migration scripts twice on fresh CI can additionally detect accidental non-repeatability of initial migration deployment.

Scaffold CI now verifies the PostGIS extension with a real spatial function plus its first Flyway migration. **This is not equivalent to proving future restaurant query correctness**. Once the first `.sql` import arrives, CI must configure Reylo's actual database connection/analysis settings, execute migrations first, and fail on a schema/query mismatch or unavailable database. Never silently fall back to a stale analysis cache as the sole CI source of truth.

## Deployment policy: Compose vs Docker Swarm

**Production deployment is staged and fail-closed.**

1. Review migration SQL, expected locks/duration, backups and restore readiness. Verify schema and currently running app-version compatibility.
2. Run a **single release-scoped Flyway job**, using the artifact/image built from the same commit as the application release. Wait for success and record migration history/version.
3. Only after success deploy the new app image or update replicas. If migration fails, **stop the rollout**, investigate without resetting volumes, and leave the previously compatible app running.
4. Observe DB errors, query performance, locks and app health. Do not assume rolling back the app automatically rolls back DDL.

For Docker Compose local development, `depends_on: {migrator: {condition: service_completed_successfully}}` is appropriate.

For **Docker Swarm** (`docker stack deploy`), do **not** rely on `depends_on`: it is not an effective deployment dependency. Implement a *CI/CD orchestrated migration job* (or external pre-deploy job) that exits non-zero on failure, and condition application rollout on that job's success. Do not run Flyway in every replicated web process or use independent on-startup migrations across replicas.

Multiple deployments must not accidentally race over the schema. Flyway protects migration history with its locking protocol, but releases should still serialize schema rollout and check compatibility.

## Failure response and recovery

| Symptom | Response |
| --- | --- |
| Postgres not healthy | Inspect health, credentials and volume; do not retry destructive commands |
| Flyway cannot connect | Confirm internal host `postgres:5432` and Compose network, database name and secrets |
| Invalid filename | Rename **unapplied** file to approved `V...__...sql` form; do not alter applied history |
| Checksum/name mismatch | Find changed already-applied SQL; restore original and create a new forward migration |
| Failed migration | Stop rollout, inspect logs and DB state, assess transactional rollback; remediate with reviewed forward migration |
| Query type check fails | Ensure the matching migration ran in the schema used by Reylo; fix SQL/types or make required schema change |
| Old app crashes after schema change | Roll back application only if DB backward compatibility was preserved; otherwise execute approved incident procedure |

No routine `DROP`, `clean`, volume deletion, `repair`, or ad hoc production SQL. RPO/RTO, backups and restore are tracked in [PostgreSQL operations](postgres.md).

## References

- https://documentation.red-gate.com/fd/versioned-migrations-273973333.html
- https://documentation.red-gate.com/fd/repeatable-migrations-273973335.html
- https://documentation.red-gate.com/fd/flyway-validate-migration-naming-setting-277579047.html
- https://documentation.red-gate.com/fd/flyway-docker
- https://docs.docker.com/reference/compose-file/services/
- https://docs.docker.com/reference/cli/docker/stack/deploy/

## PostgreSQL 18 Docker volume note

Official PostgreSQL 18 images store `PGDATA` at `/var/lib/postgresql/18/docker` and expect the volume mount at **`/var/lib/postgresql`**. Earlier images expected `/var/lib/postgresql/data`. GoodTaste's Compose now uses the 18-compatible mount. If an existing named volume was created under the older layout, do not automatically relocate or delete it: inspect, back up and follow the official major-upgrade/volume migration procedure before changing the container. See https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata.
