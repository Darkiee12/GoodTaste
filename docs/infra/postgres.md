# PostgreSQL operating contract

## Local development
- A single PostgreSQL 17 instance is launched from `infra/compose.yaml`, bound to `127.0.0.1:5432`.
- Create `infra/.env` from `.env.example` and choose local-only credentials; never reuse them in production.
- Database owner controls schema migrations and version changes. Feature agents propose schema changes via contract review.

## Migrations
- Use ordered, reviewable SQL migrations (tool to be selected when app is scaffolded); migration filename and change history are immutable after merge.
- Include forward/backward compatibility assessment and data-preservation plan for destructive changes.
- Do not auto-run destructive migrations or use `db push` as a production migration workflow.
- Protect at-rest unique constraints and foreign keys; explicit transactions for multi-table writes.

## Backups and disaster recovery
- Production: automated scheduled logical backups, secure offsite storage and actual restore test. A volume snapshot alone is not proven recoverable.
- Define RPO/RTO after choosing hosting. Track ownership and restore credentials in an external secret manager.
- Do not run `docker compose down --volumes`, `DROP DATABASE`, or bulk DELETE without explicit permission.

## Security
- Least-privilege app user, no superuser application connections, network access limited to service, TLS for remote DB, SQL parameters and safe query construction.
- Avoid storing raw menu binaries, raw user photos or unbounded AI response blobs in Postgres.

## Verification after infra boot
`pg_isready`, a read-only `SELECT 1`, then an isolated test migration with rollback check once tooling exists. Record command output, not credentials.
