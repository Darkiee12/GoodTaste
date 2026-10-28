# Administration dashboard and import studio (implemented)

**Status: Implemented** on PR #3 (`feat/food-discovery`). Admin surface
for catalog curation; all mutations gated by session RBAC, never
published automatically. Dish detail also allows status editing with a
server-checked publication checklist; publishing stays a `food:publish`
decision.

## Routes (`src/routes/`)

PR #4 adds `/admin/restaurants` for branch entry/editing, bounded structured menu
imports, item/variant retirement, source history and separate price/serving
review. It reuses Better Auth and dynamic RBAC; see
[Restaurant Discovery](restaurant-discovery.md) for the authoring contract.

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
- `V20261028_012` adds approval columns (`approved_by`, `approved_at`,
  `license_ack`, `review_ack`, `acknowledged_duplicates`).
- `V20261028_013` widens the job status CHECK with `applying` (atomic
  apply claim; re-entrant resume skips already-processed rows) and seeds
  first-party `source_providers` rows (`manual`, `partner`, `community`,
  `other`) so normal registry imports always resolve provenance.
- New purpose-specific Reylo queries: `admin-dishes-by-status`,
  `admin-dishes-recent`, `admin-dishes-missing-ingredients-count`,
  `admin-import-jobs-by-status`, `admin-import-jobs-recent`,
  `admin-import-job-find`, `admin-import-records-by-job` (string IDs for JSON).

## Import lifecycle (current scope)

Upload → Source → Validate → Issues → Confirm → Apply → Done. Validate
preflight-rejects duplicate slugs, then stages records atomically; jobs
with ≥1 valid record validate (invalid rows are skipped, never applied).
Duplicates are advisory (`duplicateOf` + curation note); the wizard
requires explicit per-duplicate acknowledgment, merge/update stays
disabled with an on-screen reason. Apply claims the job atomically
(`validated` → `applying`; a concurrent apply gets a typed conflict and
a crashed apply is resumable by re-entry), verifies the stored license
need plus review/duplicate acknowledgments server-side (persisted with
the approver identity), writes `source_records` + `dish_sources` links
per record, and lands dishes in `review`. Job/record rows make progress
reload-safe; detail polls every 5 s while the job is open.

CSV places use `ISO[:association]` (`origin` | `associated` |
`popular`); a bare code means `associated`, never `origin`. CSV parsing
rejects duplicate headers, ragged rows, and misplaced quotes with
row numbers. Server-side UTF-8 byte length (not client metadata)
enforces the 2 MiB upload cap.

## Known limitations (follow-up)

- Apply is synchronous and bounded (100 records/job); no background worker yet.
- No per-record skip or merge/update actions (disabled in UI with reasons).
- Provenance needs a matching `source_providers` row; unknown sources skip
  writes rather than inventing providers.
- Dish-family cycles are rejected in the service layer (bounded ancestor
  walk); concurrent conflicting parent edits can still interleave — a DB
  trigger would close that TOCTOU window.
