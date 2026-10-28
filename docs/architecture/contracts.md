# Cross-module contracts

A module exposes only the smallest necessary public server operations through `src/modules/<module>/server/index.ts`. Other modules and workflows must not import its private repository, SQL, or operations implementation files.

Direct one-way calls are permitted; cyclic dependencies are not. A workflow under `src/server/workflows/` coordinates use cases spanning Food Discovery, Restaurant Discovery and User. Domain modules do not need a wrapper interface for every simple function; use meaningful Effect services at external/resource boundaries.

**Core example:** Food Discovery returns dish identities and food details; Restaurant Discovery takes identifiers/criteria and returns places plus *sourced serving evidence*; an orchestration workflow combines results, optionally informed by member preferences. It must not turn inferred matches into confirmed restaurant menu facts.

## Implemented catalog contracts (Food Discovery)

Food's public `getPublishedDishIdentities(ids)` is a batch read returning
Reylo-projected string IDs and slugs for published dishes only. Restaurant menu
reads use it to suppress links to subsequently unpublished dishes without an
N+1 catalog lookup. It never exposes draft metadata.

Public read operations (`DishService`, `CatalogService`) serve guests and members:

- `searchDishes`: multilingual text search with deterministic tier ranking, or
  faceted filtering (ingredients any/all, categories any/all, place subtree,
  cuisine, association), plus recency-browsed keyset pagination. Cursor
  payloads differ per sort, so cursors must never cross sort modes.
- `getDish`: accepts a decimal ID **or** canonical slug and returns the
  composed catalog profile (`id`, `slug`, localized `name`,
  `english_name`, `native_names`, localized `description`, ingredients,
  places with association/kind/ISO/display coordinates, cuisines, categories,
  `sources`, Unix-second `last_update`). IDs are strings at the HTTP boundary;
  raw `bigint` is never serialized.
- `getRelated`: sibling variants and categorically/geographically similar
  published dishes, ranked by shared relations.
- `listPlaces` returns places plus parent edges (hierarchy built client-side);
  `searchPlaces` resolves names in supported languages.

Administrative writes (`AdminService`) require a verified session whose
database grants cover the operation (see `access-control.md` for the
permission map); the legacy `x-admin-key` path was removed and there is no
machine identity:

- `createDish`: slug optional (generated from the display name with collision
  suffixes); duplicate slugs conflict instead of merging.
- `updateDish` / `updateDishStatus`: publishing runs server-side validation
  (preferred English name, category, description or summary); failures return
  `InvalidDishData` with explicit reasons rather than partial writes.
- Translation, description, ingredient/place/category/cuisine links, each of
  which records a `catalog_revisions` row in the same transaction.
- `CurationService`: `validatePublication`, `recordRevision`, curation notes
  (`review`/`correction`/`question`), revision inspection, and the review
  queue over `review`-status dishes.
- `CatalogImportService.validateImport`: parses and validates an
  Effect-Schema-checked authoring payload, resolves ingredients/places/
  cuisines/categories against canonical records, flags possible duplicates
  for human review, and stages the job plus per-record results **without**
  applying anything. `applyImport` only runs `validated` jobs, applying each
  valid record in its own transaction and recording revisions and notes.
  Unknown references invalidate the record; slugs that collide are skipped,
  never merged.

## Implemented restaurant contracts

Public operations exported by `restaurant-discovery/server/index.ts` are
`searchRestaurants`, `getRestaurant`, and `listRestaurantAreas`. Search selects
separate area, name or dish SQL strategies; price comparisons require a portion,
channel and comparison currency. The response retains the actual selected
offering, original observation, and the request's dated FX snapshot. Local
ranges need three venues with current listed, tax-included prices for the same
portion/channel/currency. Detail returns curated offerings and reviewed canonical
links; private object keys and receipt URLs never leave SQL projections.

`writeVenue`, `importMenu`, menu/item/variant status changes, and
`reviewObservation` enforce `restaurant:manage` or `restaurant:review` inside
the operation. Imports are bounded and transactional, always pending; review
is separate. Item/variant IDs cannot be reused with different identities.
Source/line duplicates conflict; no last-write-wins price replacement exists.
See [the complete contract](restaurant-discovery.md).

`FxRates` is the replaceable Effect capability for supported currencies and
dated exact pair rates; `FxProviderLive` is provided at the composition root.
An FX failure preserves ordinary menu reads but fails a dependent budget/sort.
User's published currency operations use only the verified request Actor.

Restaurant RPC and the dish search/detail RPCs use the shared client-operation
boundary for rate limits, request timeout and safe typed-error messages. Success
projections remain unchanged; raw database errors and stacks are never returned.

Before implementing a public operation, specify:
- owning module, callers and observable user outcome;
- typed input, result and expected errors;
- whether it is `public`, `member`, or member-owned, and where authorization occurs;
- source/evidence and uncertainty required for restaurant, menu and ingredient claims;
- external dependencies, retries, cancellation, transaction and idempotency behavior;
- one guest/member test and one missing/contradictory-data test when relevant.

Define multi-case domain outcomes with Effect's `Data.TaggedEnum` (or `Schema.TaggedUnion` where true codec support is necessary) rather than arbitrary stringly typed `kind` payloads. Use `Data.TaggedError`/`Schema.TaggedError` for typed failures and `Effect.catchTag` at appropriate boundaries. A trusted `Actor` is provided from the verified session, never a decoded client choice. See [domain modeling](domain-modeling.md) and [access control](access-control.md).

Do not expose raw SQL/driver exceptions through RPC. Translate expected Effect failures to client-safe outcomes at the transport edge.

Database contracts: Flyway owns all ordered DDL in `db/migrations/`; every domain owns its Reylo query files under `server/repository/sql/`. Typed query results do not replace business invariants or evidence provenance checks. Read `docs/architecture/persistence.md` before adding database layers or a repository facade.

For multi-module atomic writes, the coordinating workflow establishes a single transaction scope and supplies the same transaction-bound client to participating repositories. Each module retains ownership of its data and validation rules.
