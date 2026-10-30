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
- `FLYWAY_SCHEMAS=feastjourney`, `FLYWAY_DEFAULT_SCHEMA=feastjourney`: extension objects are initialized in `public`, but Flyway history and FeastJourney application tables are in their own schema.
- `FLYWAY_VALIDATE_MIGRATION_NAMING=true`, `FLYWAY_BASELINE_ON_MIGRATE=false`, `FLYWAY_CLEAN_DISABLED=true`.

Its SQL directory is mounted read-only at `/flyway/sql`. A `flyway_schema_history` record is created in Postgres when migration tooling initializes an appropriate schema; this is not a replacement for a database backup.

## Production role separation

**Never** use the app runtime account as the schema owner or migration superuser. Use a controlled DDL/migrator credential with ownership/migration privileges appropriate to the schema and a separate app credential with only required SELECT/INSERT/UPDATE/DELETE/USAGE rights. Manage grants in reviewed provisioning/migrations without embedding passwords in SQL or configuration committed to Git.

The application must not receive `FLYWAY_PASSWORD` or DDL credentials; the migrator must not receive AI/S3 secrets. Flyway is executed by a pre-deploy job rather than as part of every server process.

## App and Reylo variables

Server-validated application variables (`src/server/env.ts` — startup fails
fast when a required value is missing; see `.env.example` for the full list):

- Required: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`,
  `FACEBOOK_CLIENT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `EMAIL_FROM`.
- Optional: `TRUSTED_PROXIES`, `DATABASE_POOL_MAX`, `CORS_ORIGINS`,
  `RATE_LIMIT_*`, `REQUEST_TIMEOUT_MS`, `HOST`, `PORT`,
  `RECOMMENDATION_PROVIDER`, `MODEL_API_KEY`, `MODEL_MODEL_ID`,
  `MODEL_BASE_URL`, `MODEL_TIMEOUT_MS`, `MODEL_CANDIDATE_LIMIT`,
  `MODEL_OUTPUT_LIMIT`, `OWNER_EMAIL`. `DATABASE_DIRECT_URL` is declared in server config
  but not consumed by any application path yet.

- `DATABASE_URL`: server-only PostgreSQL connection for application runtime or direct Reylo development type analysis, as appropriate.
- For Reylo analysis, the URL must point **directly** to a migrated Postgres schema; avoid transaction-mode PgBouncer. A distinct development/CI connection may be used instead of the runtime pool URL.
- `S3_ENDPOINT_INTERNAL=http://garage:3900`, `S3_REGION=garage`, `S3_BUCKET_PRIVATE=feastjourney-private`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; use path-style S3 addressing. The internal URL only works inside the Compose network.
- `S3_ENDPOINT_PUBLIC` is not read by the implemented scanner. Uploads and authorized photo reads use the application origin; browsers never connect directly to Garage. Future direct signed access would need a separately reviewed endpoint and CORS contract.
- `AI_PROVIDER`, `AI_API_KEY`, `PLACES_API_KEY`, `APP_BASE_URL` and optional `LOG_LEVEL` are **not** application variables: no code reads them. The implemented equivalents are `RECOMMENDATION_PROVIDER`, `MODEL_*`, and `BETTER_AUTH_URL`. Do not reintroduce the old names.

**Important:** local Compose intentionally publishes no database port, so a host `DATABASE_URL=postgres://localhost:5432/...` is **not** reachable without a separate, explicitly approved dev access arrangement. Never solve this by exposing 0.0.0.0:5432.

## Map frontend configuration (when the UI lands)

`VITE_MAP_STYLE_URL` is a **public browser-visible** MapLibre vector-style URL; a MapTiler-hosted style is the initial recommendation. Domain/referrer-restrict the map provider key and monitor API usage. **Never** use this browser variable for private database, AI, or S3 credentials. Provider terms and pricing must be reviewed before production.

## Production and staging configuration

Staging and production share variable NAMES with local dev but never values:
copy nothing from `infra/.env.example`. The full production template is
`infra/.env.production.example` (placeholders only — real values live in
Dokploy secrets and the GitHub `staging` environment); the provisioning
contract is [deployment on Dokploy + Azure](deployment-dokploy-azure.md).

## Secret handling rules

- Validate server config at startup; fail with sanitized messages when required variables are absent.
- Explicitly allowlist client-visible variables. Never import private DB/migrator credentials into browser components.
- Use managed deployment secret storage and rotate/limit accounts. Rendered Compose config can reveal secret values: prefer `docker compose ... config --quiet` when only validating.
- Do not commit `.env`, keys, private images or database dumps. Do not print secrets in CI traces, PR descriptions or troubleshooting posts.

See [migration operations](migrations.md) and [local runbook](operations.md).

Menu scanning is optional (`MENU_SCANNER_ENABLED=false`). Enabling it requires `MODEL_API_KEY`, a valid HTTPS `MODEL_BASE_URL` (default `https://api.meta.ai/v1`) and private S3 settings. `MENU_SCAN_MODEL` supports only standard `muse-spark-1.3`; Contributor mode is excluded. Defaults: `MENU_SCAN_TIMEOUT_MS=20000`, `MENU_SCAN_RETRIES=1`, `MENU_SCAN_MAX_RESPONSE_BYTES=1048576`, `MENU_SCAN_MAX_IMAGES=6`, `MENU_SCAN_MAX_IMAGE_BYTES=8388608`, `MENU_SCAN_MAX_COMPLETION_TOKENS=12000`. Enabled invalid configuration fails at the scanner boundary, leaving unrelated reads usable.

SQL policy sets personal retention to 24 hours and explicit contributions to 30 days, including approved private photos/drafts. Repeating a submission reuses its stored consent deadline. Operators must schedule `bun run maintenance:menu-scans` at least every 15 minutes; no in-process scheduler is installed. See [storage](object-storage.md) for deletion retries and limits. Only the deployment's standard Meta terms apply unless its organization has separately obtained zero-data-retention service; `store:false` alone is not that guarantee.
