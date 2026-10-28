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
- `V20261028_005__auth_and_members.sql` — Better Auth core tables (`user`,
  `session`, `account`, `verification`, database `rateLimit`), generated from
  the installed better-auth version via `bun scripts/generate-auth-migration.ts`
  and reviewed before check-in, plus application-owned `user_profiles`,
  `favorites`, and `security_audit_events`. The generator emits unqualified
  table names (the connection's `search_path` selects the schema at runtime);
  V005 pins the schema-qualified form. Regenerate against a fresh database
  and compare semantically before writing any new migration — never hand-edit
  an applied file.
- `V20261028_006__dynamic_rbac.sql` — database-managed authorization: `roles`,
  `permissions`, `role_permissions`, `user_roles` with the static vocabulary
  seeded, system roles (member/curator/moderator/support/admin/owner), their
  initial grants, and backfill of existing users.
- `V20261028_007__user_permission_catalog.sql` — completes the user-management
  permission catalog omitted from V006 (`user:list`, `user:create`,
  `user:delete`, legacy names) with least-privilege grants to admin/owner.
- `V20261028_008__food_import_permission.sql` — adds the `food:import`
  permission for bulk catalog import validate/apply, granted to
  curator/admin/owner, replacing the legacy admin-key bypass with dynamic
  RBAC checks.
- `V20261028_009__default_member_role.sql` — AFTER INSERT trigger on `user`
  assigning the `member` role in the same transaction (email/OAuth/admin
  creation paths), idempotent via ON CONFLICT DO NOTHING.

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
