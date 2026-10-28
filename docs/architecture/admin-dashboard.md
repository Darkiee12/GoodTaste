# Administration dashboard and import studio (implemented)

**Status: Implemented** on `feat/admin-import-studio`. Admin surface for
catalog curation; all mutations gated by session RBAC, never published
automatically.

## Routes (`src/routes/`)

| Route | Responsibility |
| --- | --- |
| `/admin` | Editorial overview: attention queue, health counts, recent imports/dishes |
| `/admin/dishes`, `/admin/dishes/$dishId` | Status-filtered catalog list; curation detail (names, descriptions, links, provenance, notes, revisions) |
| `/admin/imports`, `/admin/imports/new`, `/admin/imports/$jobId` | Import history, 7-stage studio wizard, deep-linkable job detail |
| `/admin/reviews` | Review queue (status `review` dishes) |
| `/admin/users`, `/admin/roles` | Existing pages, now children of the shared `admin.tsx` shell |

`admin.tsx` is a layout shell (nav + `<Outlet/>`); permission-aware nav is
convenience only. Every page `beforeLoad` requires a session plus
`adminSurfaceFn()` (holds `admin:access`, `food:import`, or
`moderation:read`); every server function re-checks its own grant.

## Transport (`src/modules/food-discovery/`)

- `admin.schema.ts` — Zod boundary schemas, source registry
  (`SOURCE_REGISTRY` + `needsLicenseReview`), RFC-4180 CSV reader for the
  one documented CSV shape, JSON envelope parser, `FEASTJOURNEY_JSON_TEMPLATE`.
- `admin.functions.ts` — `adminSurfaceFn` (OR-gate over the three surface
  grants), stats/dishes/detail/reviews/imports server functions. File bytes
  are re-parsed server-side; client previews are never trusted.
- `server/operations/admin-dashboard-service.ts` — read aggregation plus
  `validateImport`/`applyImport` delegation to `CatalogImportService`.

## RBAC mapping

Surface read + `food:read` (stats, dishes); `moderation:read` (reviews);
`food:import` (import reads, validate, apply).mutations never run without
`food:import`. `DishService.getDishForCuration` is the status-agnostic read
for curation; public `getDish` still resolves published dishes only.

## Persistence

- `V20261028_011` adds nullable source metadata to `catalog_import_jobs`
  (`source_url`, `source_version`, `license`, `attribution`,
  `editorial_notes`) and widens `format` to `json`/`csv`.
- New purpose-specific Reylo queries: `admin-dishes-by-status`,
  `admin-dishes-recent`, `admin-dishes-missing-ingredients-count`,
  `admin-import-jobs-by-status`, `admin-import-jobs-recent`,
  `admin-import-job-find`, `admin-import-records-by-job` (string IDs for JSON).

## Import lifecycle (current scope)

Upload → Source → Validate → Issues → Confirm → Apply → Done. Validate
stages records; invalid rows are skipped, never applied. Duplicates are
advisory (`duplicateOf` + curation note); the wizard requires explicit
per-duplicate acknowledgment, merge/update stays disabled with an on-screen
reason. Apply requires a `validated` job (re-checked before running) and a
license + editorial-review acknowledgment; records land in `review`.
Job/record rows make progress reload-safe; detail polls every 5 s while
the job is open.

## Known limitations (follow-up)

- Apply is synchronous and bounded (100 records/job); no background worker yet.
- Apply accepts only fully-validated jobs; partial-valid subsets need a
  validated-with-warnings state.
- No per-record skip or merge/update actions (disabled in UI with reasons).
- Provenance: imports link ingredients/places/cuisines/categories but do
  not yet write `dish_sources`/`source_records` rows.
- Concurrent double-apply races on one job: second apply is rejected once
  the first commits (`validated` → `applied`), with a small race window.
