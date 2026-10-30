# Conceptual data ownership (implemented)

**Status: Implemented.** Flyway migrations `V20261028_001`–`V20261028_004`
create the tables below in the `feastjourney` schema; `db/migrations/README.md`
tracks the ordered history. Reylo query files live with their owning module
under `src/modules/food-discovery/server/repository/sql/`.

- `food-discovery`: canonical dish identity (`dishes` + application-owned `slug`,
  single-parent variants), multilingual `dish_names` (one preferred name per
  dish + language via partial unique index), `dish_descriptions`, `ingredients`
  + `ingredient_names` + `dish_ingredients` (roles core/common/optional/garnish),
  `cuisines` + `cuisine_names` + `dish_cuisines`, `categories` +
  `category_names` + `dish_categories`, and editorial/authoring state.
- `food-discovery` geography (shared with future restaurant work): `places`
  (continents, regions, countries with ISO 3166 codes, localities),
  `place_names`, `place_parents` (DAG with a cycle-rejecting trigger), and
  `dish_places` with `origin` / `associated` / `popular` kept distinct.
  Display coordinates are cartographic placements, never origin claims.
- Internal governance (no external encyclopedia dependency): `catalog_revisions`
  (who changed what and when), `curation_notes` (review/correction/question),
  `catalog_import_jobs` + `catalog_import_records` (staged validation, dry-run
  reports, transactional apply). Claim-level external provenance was
  deliberately removed: contested origins are recorded as disputed
  `dish_places` links plus curation notes, not as imported facts.
- Binary menu photos belong in object storage; Postgres owns metadata only.
  AI-derived results are never treated as verified.

**Dish identity != restaurant menu offering.** Serving claims retain source,
observation time and confidence/evidence semantics. User-owned fields always
require actor-based ownership checks.

Restaurant migrations `V20261028_100`–`106` add businesses, physical venues
with indexed PostGIS geography, multilingual names/cuisines, menus, items and
variants, immutable source snapshots, serving evidence, append-only price
observations and private structured receipt lines. Composite venue foreign keys
reject cross-branch links. Item/variant identities are immutable; visibility is
an explicit state change. Generated non-null coordinate projections derive from
the same geography and cannot drift independently.

`currency_codes` contains SIX's ISO 4217 monetary codes/numeric identities/minor
units; the initial ICU lookup is retained as `currency_codes_icu_legacy` but no
price/preference/FX foreign key references it. `currency_exchange_rates` keeps
exact provider/date/pair history; refresh leases and provider currency catalogs
are small PostgreSQL cache tables. User owns the nullable preferred-currency
column. No price column is added to canonical dishes. See
[Restaurant Discovery](restaurant-discovery.md) for selection and comparison policy.

Postgres constraints enforce relational integrity, Reylo types the SQL
interface, Zod validates HTTP input at the TanStack boundary, and Effect
Schema validates internal authoring/import payloads and domain invariants.

Private menu workflow extends Restaurant Discovery through `menu_scan_sessions`, `menu_scan_assets`, immutable `menu_scan_revisions` and `menu_scan_contributions`. Guest bearer hashes and verified member owners are mutually exclusive. Revision JSONB is versioned private data, not published restaurant knowledge. Contribution menu/page mappings retain provenance after promotion. Erasure clears the current-revision pointer and nullable contribution revision FK, retaining only the submitted revision number and audit metadata.

Approved original names, source language and one reviewed translation language per item/variant live in the existing relational menu tables. Price-free items also retain their source through a venue-scoped foreign key. Historical unknowns remain NULL. Inferred ingredient explanations are never promoted into canonical dish attributes. Photos remain registered private assets with the same consented deletion lifecycle even after approval.

Price observations preserve the optional literal printed token in `raw_text` separately from exact NUMERIC `amount`. Unknown historical tokens are NULL; they are never reconstructed and passed off as printed evidence.
