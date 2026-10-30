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
- `V20261028_010__remove_orphan_user_read.sql` — removes the orphaned
  `user:read` key (seeded by V006 but absent from the code vocabulary and
  never checked) and grants support the vocabulary-backed `user:list` for
  its documented read-only user views.
- `V20261028_011__import_job_source_metadata.sql` — additive nullable
  columns on `catalog_import_jobs` (`source_url`, `source_version`,
  `license`, `attribution`, `editorial_notes`) so the import studio keeps
  source metadata with the job; widens the `format` check to `json`/`csv`
  (staged payloads stay validated JSON records).

- This directory contains **schema/data migrations**, not application Reylo queries.
- Create next versioned SQL files such as `V20261027_002__create_user_accounts.sql` after domain ownership and schema review.
- Never edit, rename or delete a versioned migration that has been applied to a persistent database; add another migration instead.
- Use `R__name.sql` only for genuinely repeatable, idempotent database objects (views/functions), not arbitrary data rewrites.
- SQL files in this directory are executed by Flyway **before** the application deploys; do not import them from TypeScript.
- PostgreSQL owns constraints and transaction integrity. Reylo analyzes application query files against the schema resulting from these migrations.

See `docs/infra/migrations.md`, `docs/infra/postgres.md`, and `docs/architecture/persistence.md`.

PR #4 reserves `V20261028_100`–`106` beyond PR #3's inspected `_013` head:

- `_100` creates Restaurant Discovery tables/views, PostGIS/trigram indexes,
  exact observation history, FX cache/leases, User currency preference and RBAC grants.
- `_101` enforces immutable provenance and receipt source/amount integrity.
- `_102` maintains diacritic-folded restaurant search names with a trigger.
- `_103` installs SIX ISO 4217 monetary codes and reattaches currency foreign
  keys; the initial ICU lookup is preserved as an unused legacy table.
- `_104` adds generated non-null coordinate projections of venue geography.
- `_105` protects item/variant identity and adds variant retirement.
- `_106` preserves unknown receipt adjustments as NULL rather than fabricated zero.

All are forward-only. No parent migration is modified. Review numbering against
any later PR #3 migrations before integration; rollback is application rollback
with the additive schema retained, not Flyway clean/repair or data deletion.

A checked-in migration is immutable once applied. Never edit, rename, or
delete an applied file; write the next forward migration instead.

Flyway manages the `feastjourney` app schema and schema history, while PostGIS extension objects are in `public` on initialization. Schema-qualify future app tables or set search_path intentionally; do not enable automatic baselining merely to bypass PostGIS-created public objects.

Scanner forward migrations:

- `V20261029_001`: four private scan workflow tables, guest/member ownership, immutable revisions and consented contributions.
- `V20261029_002`: legacy restaurant-verification claims no longer raise price authority.
- `V20261029_003`: contribution-to-relational-menu and private source-page mapping.
- `V20261030_100`: erasable revision references with retained submitted revision numbers, deletion cooldown, supporting pages, reviewed menu/item text and draft variant status.
- `V20261030_101`: venue-scoped source foreign key for price-free menu items; deferred until transaction commit to support atomic dependent changes.
- `V20261030_102`: reviewed variant translations stored with immutable offering identity.
- `V20261030_103`: original printed price tokens retained beside exact NUMERIC observations.

The uncommitted scanner migrations were allocated this separate range before release because Food Discovery added `V20261030_001`. Earlier scanner numbering was exercised only in a disposable test database, which is preserved; validate the combined history against a fresh database rather than repairing or rewriting that history.

These do not create a second published menu store. Private JSONB is temporary; approved facts continue to use the existing restaurant tables. Never change an applied file to resolve a failed check.
