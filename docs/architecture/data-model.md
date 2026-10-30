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

Postgres constraints enforce relational integrity, Reylo types the SQL
interface, Zod validates HTTP input at the TanStack boundary, and Effect
Schema validates internal authoring/import payloads and domain invariants.
