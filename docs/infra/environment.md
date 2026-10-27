# Environment configuration and secrets

## Local Compose `infra/.env`

Copy `infra/.env.example` to `infra/.env`. Required local-only variables:

| Variable | Owner | Notes |
| --- | --- | --- |
| `POSTGRES_USER` | PostgreSQL initialization + Flyway | Local bootstrap account; do **not** assume this role is suitable for production app queries |
| `POSTGRES_PASSWORD` | PostgreSQL initialization + Flyway | Local-only, never publish/log |
| `POSTGRES_DB` | PostgreSQL initialization + Flyway | Injected into Flyway JDBC URL; must match initialized database |
| `GARAGE_RPC_SECRET` | Garage node/CLI | 32 random bytes encoded as 64 hex characters; server-only |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Garage local bucket bootstrap / future app | Fresh local S3 credentials; distinct from the RPC secret |

Flyway image is pinned to `flyway/flyway:13.11.1` in `infra/compose.yaml`. It reads:

- `FLYWAY_URL=jdbc:postgresql://postgres:5432/${POSTGRES_DB}`
- `FLYWAY_USER`, `FLYWAY_PASSWORD`: wired to local Postgres bootstrap values only.
- `FLYWAY_SCHEMAS=goodtaste`, `FLYWAY_DEFAULT_SCHEMA=goodtaste`: extension objects are initialized in `public`, but Flyway history and GoodTaste application tables are in their own schema.
- `FLYWAY_VALIDATE_MIGRATION_NAMING=true`, `FLYWAY_BASELINE_ON_MIGRATE=false`, `FLYWAY_CLEAN_DISABLED=true`.

Its SQL directory is mounted read-only at `/flyway/sql`. A `flyway_schema_history` record is created in Postgres when migration tooling initializes an appropriate schema; this is not a replacement for a database backup.

## Production role separation

**Never** use the app runtime account as the schema owner or migration superuser. Use a controlled DDL/migrator credential with ownership/migration privileges appropriate to the schema and a separate app credential with only required SELECT/INSERT/UPDATE/DELETE/USAGE rights. Manage grants in reviewed provisioning/migrations without embedding passwords in SQL or configuration committed to Git.

The application must not receive `FLYWAY_PASSWORD` or DDL credentials; the migrator must not receive AI/S3 secrets. Flyway is executed by a pre-deploy job rather than as part of every server process.

## App and Reylo variables (to finalize with app scaffold)

- `DATABASE_URL`: server-only PostgreSQL connection for application runtime or direct Reylo development type analysis, as appropriate.
- For Reylo analysis, the URL must point **directly** to a migrated Postgres schema; avoid transaction-mode PgBouncer. A distinct development/CI connection may be used instead of the runtime pool URL.
- `S3_ENDPOINT_INTERNAL=http://garage:3900`, `S3_REGION=garage`, `S3_BUCKET_PRIVATE=goodtaste-private`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; use path-style S3 addressing. The internal URL only works inside the Compose network.
- `S3_ENDPOINT_PUBLIC`: browser-valid presigned hostname, deliberately unset until an approved loopback mapping or reverse proxy exists. Do not sign browser URLs for `garage:3900` or rewrite signed hostnames afterward.
- `AI_PROVIDER`, `AI_API_KEY`, `PLACES_API_KEY`, `APP_BASE_URL` and optional `LOG_LEVEL`.

**Important:** local Compose intentionally publishes no database port, so a host `DATABASE_URL=postgres://localhost:5432/...` is **not** reachable without a separate, explicitly approved dev access arrangement. Never solve this by exposing 0.0.0.0:5432.

## Map frontend configuration (when the UI lands)

`VITE_MAP_STYLE_URL` is a **public browser-visible** MapLibre vector-style URL; a MapTiler-hosted style is the initial recommendation. Domain/referrer-restrict the map provider key and monitor API usage. **Never** use this browser variable for private database, AI, or S3 credentials. Provider terms and pricing must be reviewed before production.

## Secret handling rules

- Validate server config at startup; fail with sanitized messages when required variables are absent.
- Explicitly allowlist client-visible variables. Never import private DB/migrator credentials into browser components.
- Use managed deployment secret storage and rotate/limit accounts. Rendered Compose config can reveal secret values: prefer `docker compose ... config --quiet` when only validating.
- Do not commit `.env`, keys, private images or database dumps. Do not print secrets in CI traces, PR descriptions or troubleshooting posts.

See [migration operations](migrations.md) and [local runbook](operations.md).
