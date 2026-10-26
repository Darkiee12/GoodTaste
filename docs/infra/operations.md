# Local operations and infrastructure checks

This runbook describes the **proposed local dev** Compose configuration. No remote host is targeted.

## Prerequisites
Docker Engine with Compose plugin. Bun/Node for app implementation later. Optional AWS CLI for bucket smoke tests.

## Start (local only)
1. From repo root: `cp infra/.env.example infra/.env` (or copy manually on Windows).
2. Set new local-only secrets in `infra/.env`; review and approve the MinIO legacy image risk.
3. Validate: `docker compose --env-file infra/.env -f infra/compose.yaml config` (do not paste output in public logs; it contains credentials).
4. Start: `docker compose --env-file infra/.env -f infra/compose.yaml up -d`.
5. Verify: `docker compose --env-file infra/.env -f infra/compose.yaml ps`, then Postgres `pg_isready`, MinIO API on `http://127.0.0.1:9000` and console at `http://127.0.0.1:9001` (local only).
6. Create a private bucket `goodtaste-private` via reviewed CLI/UI provisioning. Verify that anonymous GET is forbidden. The MVP does **not** require a public bucket.
7. Before real uploads, test local S3 API auth, presign URL hostname, CORS and deletion using an integration test.

## Stop safely
`docker compose --env-file infra/.env -f infra/compose.yaml stop` stops without deleting volumes. `down` removes containers/network; **never add `-v`** without user authorization and data backup.

## Recovery
- DB unavailable: check container status and volume capacity, review redacted logs, avoid reset; run read-only health check.
- Object store unavailable: verify volume, credentials and endpoint DNS; do not change ACL to public as a workaround.
- Signed URL fails from browser: check public endpoint hostname/TLS, region/addressing and CORS; `minio:9000` only resolves from Compose network.

## Production prerequisites
Choose supported object-store provider, deploy app, configure HTTPS, backups + restore rehearsal, quotas/rate limits, monitoring, secret rotation, data retention and incident ownership. Local Compose is never a production deployment plan.
