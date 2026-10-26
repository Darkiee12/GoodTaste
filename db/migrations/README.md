# Flyway migrations

The first migration enables or verifies **PostGIS**; no business/domain tables are designed or migrated yet.

- This directory contains **schema/data migrations**, not application Reylo queries.
- Create next versioned SQL files such as `V20261027_002__create_user_accounts.sql` after domain ownership and schema review.
- Never edit, rename or delete a versioned migration that has been applied to a persistent database; add another migration instead.
- Use `R__name.sql` only for genuinely repeatable, idempotent database objects (views/functions), not arbitrary data rewrites.
- SQL files in this directory are executed by Flyway **before** the application deploys; do not import them from TypeScript.
- PostgreSQL owns constraints and transaction integrity. Reylo analyzes application query files against the schema resulting from these migrations.

See `docs/infra/migrations.md`, `docs/infra/postgres.md`, and `docs/architecture/persistence.md`.

An initial schema must be chosen and reviewed before writing `V1` or any other DDL. This README is not itself a Flyway migration.

Flyway manages the `goodtaste` app schema and schema history, while PostGIS extension objects are in `public` on initialization. Schema-qualify future app tables or set search_path intentionally; do not enable automatic baselining merely to bypass PostGIS-created public objects.
