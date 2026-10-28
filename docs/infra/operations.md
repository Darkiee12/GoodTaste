# Local operations and infra verification

This runbook covers **local-only** Docker Compose, not production deployment or Docker Swarm. Garage runs as a single node without redundancy.

## Prerequisites

Docker Engine + recent Compose plugin, repository checkout, adequate local disk and ability to pull `postgis/postgis:18-3.6-alpine`, `flyway/flyway:13.11.1`, and `dxflrs/garage:v2.5.0`. Bun/Node is needed for application development.

## Safe local setup

Run from repository root. On Windows, copy `.env.example` manually if a POSIX `cp` command is unavailable.

```bash
cp infra/.env.example infra/.env
# Set fresh local-only values, including Garage credentials (see object-storage.md).
docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
```

The full `config` output expands secrets; use `--quiet` for validation without dumping them. Never commit `infra/.env`.

## PostgreSQL and one-shot Flyway

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator validate
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator info
docker compose --env-file infra/.env -f infra/compose.yaml ps
```

For official PostgreSQL 18 images, the named volume is mounted at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data` (the PostgreSQL 17-and-earlier convention). Existing volumes from the old layout must be backed up and reviewed before manual migration. Never drop or recreate a volume as a quick fix.

The first command waits for the Postgres health check, the second runs pending Flyway migrations and **must exit 0** before running app code, and the third validates the applied history. `run --rm` removes the transient migrator container. Migrations are listed in `db/migrations/README.md`. Do not infer that a successful no-op migration means the expected schema is installed: always check `migrator info` output.

For a full local dependency startup:

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up -d
```

This also starts Garage and the one-shot `migrator`. Check its exit status/logs rather than assuming `up -d` proves migration success. When the app container is introduced it **must** use `depends_on: migrator: {condition: service_completed_successfully}`. Until that app exists, the foreground `run --rm migrator` command is the clearer gate.

If an image cannot be downloaded or credentials are wrong, investigate **without deleting volumes**. To change a migration file already applied, add a new migration instead of editing the original.

## Garage and private bucket

Follow [object storage setup](object-storage.md) to generate credentials, start only Garage, and inspect its cluster/bucket. Startup creates the private `feastjourney-private` bucket using Garage's single-node bootstrap flags. No host ports are published; `http://garage:3900` is reachable only within the Compose network. The landing page does not use storage yet.

Before enabling real uploads test CORS, object type/size verification, presign semantics and deletion with synthetic data.

## App + Reylo connection

The API runs as part of the TanStack Start server (no separate HTTP process).
Host-side tooling reaches the Compose database through a loopback-only port
mapping declared in `infra/compose.ports.yaml`. This file is additive and
local-only: it never opens public ports and application containers keep using
the internal `postgres:5432` address.

```bash
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml run --rm migrator validate
```

TypeScript's Reylo analysis uses a direct connection to the **migrated** database.
Point it at the loopback endpoint (values must match `infra/.env`):

```bash
export DATABASE_URL="postgres://USER:PASSWORD@127.0.0.1:5433/feastjourney"
export ADMIN_API_KEY="local-only-admin-key"
bun run check-types
bun test tests/
bun run build
bun run dev
```

Reylo typechecking fails closed without a migrated, reachable database; a stale
`.reylo/` cache is never accepted as proof in CI (the cache directory
self-ignores via its own `.gitignore`). Never commit real credentials or expose
the loopback mapping beyond `127.0.0.1`.

## Authentication (local)

Copy `.env.example` to `.env` and fill in secrets (never commit `.env`).
`DATABASE_URL` must point at the migrated Compose database; `BETTER_AUTH_URL`
is this deployment's public base URL (OAuth callbacks, email links).

Local email delivery: run Mailpit and point SMTP at it —

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

— then read mail at `http://localhost:8025`. Without reachable SMTP the
server refuses to start; tests use an in-memory sender instead.

Bootstrap the first administrator (shell + database access required; there is
no HTTP path to admin):

```bash
bun scripts/create-admin.ts admin@example.com 'strong-password-here'
```

Every use is recorded in `security_audit_events` (`auth.role.changed`,
`via: bootstrap-cli`); record it out-of-band as well.

## Catalog administration (local)

Administrative writes require `ADMIN_API_KEY` (never commit it, never ship it
to browsers). The local API runs through `bun run dev` (port 3000) once the
database is migrated and `DATABASE_URL` is exported.

Publication policy is enforced server-side: publishing requires a preferred
English name, at least one category, and a description or summary, plus a
canonical slug. Drafts may be incomplete; they are never served publicly.

```bash
BASE=http://localhost:3000 ADMIN_KEY=local-only-admin-key

curl -s -X POST "$BASE/api/v1/dishes" -H "x-admin-key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"status":"draft","names":[{"language_tag":"en","name":"Test Dish","name_kind":"localized"}]}'

curl -s "$BASE/api/v1/dishes/test-dish?locale=en"

curl -s -X POST "$BASE/api/v1/admin/imports/validate" -H "x-admin-key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"source_name":"curated-batch-1","records":[{...validated authoring records...}]}'

curl -s -X POST "$BASE/api/v1/admin/imports/apply" -H "x-admin-key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"job_id":"<id-from-validate-step>"}'

curl -s "$BASE/api/v1/admin/review-queue?limit=20" -H "x-admin-key: $ADMIN_KEY"
```

Validation (`imports/validate`) stages the job and per-record results without
applying anything; `imports/apply` runs each valid record in its own
transaction and records revisions, curation notes for possible duplicates, and
the final job outcome. Imports never overwrite curated rows and never merge
distinct dishes on name similarity alone.

## Stop and investigate

```bash
docker compose --env-file infra/.env -f infra/compose.yaml stop
docker compose --env-file infra/.env -f infra/compose.yaml ps -a
```

`stop` preserves containers and volumes; ordinary `down` removes containers/network while keeping named volumes. Do not add `--volumes` to local commands without explicit user authorization and a data backup.

- PostgreSQL down: inspect health check, local disk and DB logs; use read-only diagnostics.
- Migrator failed: check its exit code, schema-history state, SQL filename and errors; **block app deployment** until resolved. `flyway repair` is not normal recovery.
- Reylo check fails: verify migrated schema, direct connection and SQL import; no silent cache-only success in CI.
- Garage unavailable: inspect health, internal DNS, RPC secret, S3 credentials, and both volumes; never enable public website access or expose administration ports as an emergency workaround.

## Production and CI

Local Compose is not a production deployment. For Docker Swarm, `depends_on` is **not** a rollout gate; run exactly one release-scoped Flyway job through deployment orchestration and deploy/update the app only after success. Use separate DDL/runtime DB credentials, reviewed rollback compatibility, backups, monitoring and a supported object-store provider.

See [migration and deployment policy](migrations.md), [database operation](postgres.md) and [quality gates](../development/quality-gates.md).
