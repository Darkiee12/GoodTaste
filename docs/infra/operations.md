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

The first command waits for the Postgres health check, the second runs pending Flyway migrations and **must exit 0** before running app code, and the third validates the applied history. `run --rm` removes the transient migrator container. The migration files currently contain only the directory README until schema work is approved. Do not infer that a successful no-op migration means a user/dish/restaurant table exists.

For a full local dependency startup:

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up -d
```

This also starts Garage and the one-shot `migrator`. Check its exit status/logs rather than assuming `up -d` proves migration success. When the app container is introduced it **must** use `depends_on: migrator: {condition: service_completed_successfully}`. Until that app exists, the foreground `run --rm migrator` command is the clearer gate.

If an image cannot be downloaded or credentials are wrong, investigate **without deleting volumes**. To change a migration file already applied, add a new migration instead of editing the original.

## Garage and private bucket

Follow [object storage setup](object-storage.md) to generate credentials, start only Garage, and inspect its cluster/bucket. Startup creates the private `feastjourney-private` bucket using Garage's single-node bootstrap flags. No host ports are published; `http://garage:3900` is reachable only within the Compose network. The landing page does not use storage yet.

Before enabling real uploads test CORS, object type/size verification, presign semantics and deletion with synthetic data.

## App + Reylo connection caveat

No application container is currently defined in `infra/compose.yaml`. TypeScript's Reylo analysis uses a direct connection to the **migrated** database. Because Postgres has no published port, a host-side Bun process cannot automatically reach it. Decide on a network-local typecheck runner or a loopback-only local mapping when integrating the first `.sql` import; document the arrangement rather than silently using a public port.

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
