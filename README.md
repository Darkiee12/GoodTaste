# FeastJourney

Mobile-first food discovery for travellers: culturally relevant dishes, verified places that serve them, menu understanding, and bilingual orders. Built as a TanStack Start + Effect modular monolith with PostgreSQL 18/PostGIS, Reylo typed SQL, Flyway migrations, and Better Auth sessions.

Start with `AGENTS.md`, then `docs/README.md`.

## Run locally

Use Bun 1.4.4 (verified) to install and run tooling:

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:3000`. The landing page requires no database, but catalog, auth, and admin flows need PostgreSQL 18 with all migrations applied plus the environment in `.env` (see `docs/infra/environment.md` and `docs/infra/operations.md`):

```sh
cp infra/.env.example infra/.env
docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml run --rm migrator
export DATABASE_URL="postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney"
```

```sh
bun run format:check
bun run typecheck
bun run test
bun run build
bun run start
```

The default production build targets Bun. For Node, rebuild with `bun run build:node` and then run `bun run start:node`. Both outputs use `.output/`, so rebuilding replaces the previous target. Configure the listening address with `HOST` and `PORT`.

## Routes

- `/dishes`, `/dishes/$slug` — public catalog search and detail, with canonical dish IDs carried into restaurant search.
- `/restaurants`, `/restaurants/$venueId` — independent public restaurant search, optional map/geolocation, branch menus, exact observed prices and optional dated currency equivalents.
- `/admin/restaurants` — RBAC-protected venue and menu entry, structured source imports, offering retirement and separate price/serving review.

- `/` — public landing page with dish discovery (English default, `?lang=` switch for vi/hi/es/zh, validated by Zod; no cookie persistence).
- `/recommend` — public food chooser: one-click quick find or Surprise (windowed pool variety, constraints preserved, provider bypassed), optional 5-step refinement (meal → avoidances → region → mood → review) with skip shortcuts, server-filtered country select, in-memory journey restore across dish visits (max 10 published dishes, deterministic fallback labeled honestly, opt-in device-local preference memory).
- `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email` — Better Auth email + Google/Facebook OAuth.
- `/settings/account`, `/settings/security` — profile, linked accounts, sessions, password change.
- `/admin`, `/admin/dishes`, `/admin/dishes/$dishId`, `/admin/imports`, `/admin/imports/new`, `/admin/imports/$jobId`, `/admin/reviews`, `/admin/users`, `/admin/roles` — administration shell (session + `admin:access`/`food:import`/`moderation:read` surface gate; every operation re-checks its own grant).
- `/api/v1/*` — public discovery reads (`dishes`, `ingredients`, `categories`, `cuisines`, `places`) and session-authorized admin endpoints (`admin.dishes.*`, `admin.imports.validate|apply`, `admin.review-queue`). No API keys: all admin access resolves the Better Auth session against database RBAC grants. Public recommendations (`recommendDishesFn`) return up to 10 published dishes with explicit `ai`/`deterministic`/`uncertain`/`empty` modes; see `docs/architecture/recommendations.md`.

See `docs/architecture/access-control.md` (permission vocabulary, system roles, owner safeguards) and `docs/architecture/admin-dashboard.md` (dashboard routes, contracts, import lifecycle).

## Catalog data and imports

Restaurant menus and prices are editorial observations, not AI estimates or live
availability. There is no seeded restaurant inventory: authorized staff must
record real branches and source-backed offerings. Original currency stays
primary; Frankfurter v2 provides optional daily reference equivalents. Strict
budgets require a canonical dish, comparable portion, channel and known current
listed price. See [Restaurant Discovery](docs/architecture/restaurant-discovery.md)
for import contracts, ranking, FX policy, environment and deferred features.

Canonical dishes live in `feastjourney.dishes` plus names/descriptions/ingredients/cuisines/categories/places link tables (`db/migrations/V20261028_001`–`V004`). The import studio (`/admin/imports`) stages JSON/CSV datasets into `catalog_import_jobs`/`catalog_import_records`, validates against canonical taxonomy, requires explicit license + editorial-review acknowledgment plus per-duplicate decisions, and applies records as `review` status — never published. Applied records carry `source_records`/`dish_sources` provenance links. Publication is a separate `food:publish`-gated editorial action.

## Testing

```sh
bun test tests/
```

Integration tests run against a disposable PostgreSQL database (refusing non-loopback targets), migrate it with Flyway, then exercise auth, RBAC, catalog, curation, and import journeys end to end. SQL typechecking (`bun run typecheck`) requires the migrated development database via `DATABASE_URL` (Reylo content mapper); `bun run check` covers format, lint, and types.

## Infrastructure

- One-shot Flyway migrator (`infra/compose.yaml`) applies reviewed `db/migrations/*.sql` before app startup; migrations are immutable once applied — add forward files only.
- Garage provides private S3-compatible object storage for local development; Postgres owns metadata and access policy.

Source references are collected in `docs/references.md`.
