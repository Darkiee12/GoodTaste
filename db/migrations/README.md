# Flyway migrations

Versioned, immutable schema history for the `feastjourney` app schema:

- `V20261027_001__enable_postgis.sql` — PostGIS prerequisite.
- `V20261028_001__food_catalog.sql` — canonical 3NF catalog (dishes,
  multilingual names/descriptions, ingredients, places + hierarchy,
  cuisines, categories, source providers/records, claim-level provenance).
- `V20261028_002__seed_catalog.sql` — curated multilingual seed data across
  continents and writing systems.
- `V20261028_003__editorial_catalog.sql` — application-owned slugs, removal
  of encyclopedia-coupled columns/provenance, category slug alignment,
  place-hierarchy cycle guard, and internal editorial/audit records
  (`catalog_revisions`, `curation_notes`, `catalog_import_jobs`,
  `catalog_import_records`).
- `V20261028_004__catalog_additions.sql` — Phở gà variant, chicken ingredient,
  Valencia locality and associated popularity link.

- This directory contains **schema/data migrations**, not application Reylo queries.
- Create next versioned SQL files such as `V20261027_002__create_user_accounts.sql` after domain ownership and schema review.
- Never edit, rename or delete a versioned migration that has been applied to a persistent database; add another migration instead.
- Use `R__name.sql` only for genuinely repeatable, idempotent database objects (views/functions), not arbitrary data rewrites.
- SQL files in this directory are executed by Flyway **before** the application deploys; do not import them from TypeScript.
- PostgreSQL owns constraints and transaction integrity. Reylo analyzes application query files against the schema resulting from these migrations.

See `docs/infra/migrations.md`, `docs/infra/postgres.md`, and `docs/architecture/persistence.md`.

A checked-in migration is immutable once applied. Never edit, rename, or
delete an applied file; write the next forward migration instead.

Flyway manages the `feastjourney` app schema and schema history, while PostGIS extension objects are in `public` on initialization. Schema-qualify future app tables or set search_path intentionally; do not enable automatic baselining merely to bypass PostGIS-created public objects.
