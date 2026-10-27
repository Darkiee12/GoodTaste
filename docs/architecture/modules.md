# Canonical directory and module rules

**Status: authoritative scaffold convention.** The tree is a *target layout*, not a claim the code already exists. Create real files only when the related functionality is implemented.

```text
src/
├── routes/                            # TanStack pages; routes/api for external HTTP/webhooks
├── modules/
│   ├── user/
│   │   ├── components/
│   │   ├── user.schema.ts            # Client-safe Zod 4.6 transport schemas
│   │   ├── user.functions.ts         # createServerFn wrappers
│   │   └── server/
│   │       ├── index.ts              # Intentional server-only public module API
│   │       ├── operations/
│   │       └── repository/sql/       # Owned Reylo .sql queries
│   ├── food-discovery/
│   │   ├── components/
│   │   ├── food.schema.ts
│   │   ├── food.functions.ts
│   │   └── server/
│   │       ├── index.ts
│   │       ├── operations/
│   │       └── repository/sql/
│   └── restaurant-discovery/
│       ├── components/
│       ├── restaurant.schema.ts
│       ├── restaurant.functions.ts
│       └── server/
│           ├── index.ts
│           ├── operations/
│           └── repository/sql/
├── server/
│   ├── auth/                          # Verified Actor ADT, CurrentActor service, access policy
│   ├── database/                      # Pool, migration lifecycle, transactions
│   ├── integrations/                  # AI, Places and object storage adapters
│   ├── workflows/                     # Genuine multi-module use cases
│   ├── layers.ts                      # Effect composition root
│   └── runtime.ts                     # Server-only ManagedRuntime
├── components/ui/                     # Shared visual primitives
└── shared/                            # Deliberately shared client-safe types
```

TanStack-specific `src/start.ts`/`src/server.ts` framework entrypoints may be added as required by its current documented conventions; Effect does **not** replace TanStack's HTTP server.

## Ownership and imports

- Application source imports through the `@/*` path alias (resolving to `src/*`) for every application-to-application import, including same-directory siblings; do not write relative `../` or `./` application imports. The alias is declared in `tsconfig.json` (`paths`) and resolved by Vite (`vite-tsconfig-paths`), `tsc`, Oxlint, and Bun. Generated files (`src/routeTree.gen.ts`) and vendored trees (`repos/`, `tools/oxlint/`) are exempt and keep their own import style.
- `routes/` owns navigation, page rendering and HTTP route registration; no SQL or business policy.
- Restaurant Discovery owns its MapLibre-based browser map components and Reylo/PostGIS geosearch operations; no unrelated top-level `maps/` domain. Read [maps](maps.md) before implementation.
- `<module>/*.functions.ts` is a **transport adapter**: validate external input, resolve server-trusted actor, authorize, invoke Effect, serialize safe output. TanStack's static `createServerFn` imports are allowed in React; do not dynamically import these functions.
- `<module>/*.schema.ts` is a client-safe Zod HTTP/input schema; never duplicate Reylo-inferred row types solely to validate database rows.
- `src/server/auth/actor.ts` conceptually owns the **Effect `Data.TaggedEnum`** for `Guest` and `Member`; `src/server/auth/current-actor.ts` conceptually declares the request-scoped `Context.Service`. Construct members only after verifying server sessions; do not import either into browser components.
- `<module>/server/` owns application/domain operations and its SQL queries. Other modules can import only its intentional `server/index.ts` exports, not internal operation or repository files.
- Browser-facing modules never import `src/server/` or another module's `server/` directly. Never mix client-safe and server-only exports in one barrel.
- `src/server/` owns shared infrastructure and multi-domain workflows, not a dumping ground called `services/`.
- `src/routes/api/` is for external raw HTTP or webhooks, not a second backend. Public APIs and internal server functions invoke the **same** application operations.
- `repos/effect/` is read-only reference source, not the runtime dependency and not application code.

No root `packages/`, no generic root `services/`, and no parallel `backend/` project until justified by real independent reuse or deployment. A package boundary is not a substitute for an ownership boundary. Do not create placeholders just to fill the tree.

## Module interactions

- A module **may** call another module's public server operation when the dependency is one-way and the contract is stable.
- Cross-domain orchestration (e.g. recommend food and find places serving it) lives in `src/server/workflows/`: it can call Food Discovery, Restaurant Discovery and optionally User preferences.
- If A needs B and B needs A, fix the ownership or move the orchestration upwards; do not conceal cycles behind Effect services.
- Neither domain reads the other's SQL or directly mutates its tables. Cross-module writes coordinate a **single shared database transaction** from the workflow when atomicity is required.
- Food Discovery owns the canonical dish concept. Restaurant Discovery owns venue records, source-backed menu/serving evidence and venue-to-dish associations. User owns member account and saved items.
- Menu translation and ordering start as module operations/workflows; do not pre-create new domains to accommodate hypothetical future features.

## Schema and query placement

Schema migrations always live at repository root in `db/migrations/` under a single Flyway version history. Reylo application query files belong to their owning module in `server/repository/sql/`, one statement per `.sql` file. An application module may use a repository adapter when it adds genuine value; it is not required to create `repository.ts` or `service.ts` as boilerplate. Database pool and transaction infrastructure remain in `src/server/database/`, but Flyway execution stays outside the application process.

Read [Effect domain modeling](domain-modeling.md) before defining authenticated actors, domain ADTs, errors or outcome variants. Read [persistence conventions](persistence.md) and [migration lifecycle](../infra/migrations.md) before creating SQL files or DDL.

## Agent review rule

Before adding a file, state its owning module and whether it is browser-safe, transport, application, or infrastructure. Before a cross-module import, identify the published contract and check for cycles. Shared contract edits need coordinator review. Static lint is not yet a substitute for enforcing import ownership.

## shadcn primitives

- CLI-managed primitives live in `src/components/ui/` (installed with `bunx --bun shadcn@latest add ...`, configured by `components.json`: new-york style, no RSC, `lucide` icons, `@/` alias to `src/*`). Class merging comes from the `cn` package and primitives from the `radix-ui` package; there is no hand-written `lib/utils`.
- Installed components are owned source: customize them in place to match the product palette (e.g. the dropdown menu's semantic tokens are mapped onto the dark header colors in `src/styles.css`). Theme additions stay minimal: only tokens referenced by installed components.
- Update from upstream with `--dry-run`/`--diff` merges; never hand-fetch upstream files. New primitives need coordinator approval as shared-contract surface.
