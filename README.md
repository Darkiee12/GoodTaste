# FeastJourney

Mobile-first food discovery for travellers: culturally relevant dishes, verified places that serve them, menu understanding, and bilingual orders. Built as a TanStack Start + Effect modular monolith with PostgreSQL 18/PostGIS, Reylo typed SQL, Flyway migrations, and Better Auth sessions.

Start with `AGENTS.md`, then `docs/README.md`.

## Run locally

Prerequisites: Bun 1.4.4 (verified), Docker, `openssl` for secret generation.

### 1. Configure the environment

```sh
cp .env.example .env
# Fill in real values. At minimum generate the session secret:
# openssl rand -base64 32  # -> BETTER_AUTH_SECRET
```

Startup validates configuration and fails fast on missing values (see
`src/server/env.ts`); the full variable contract is in
`docs/infra/environment.md`. The landing page needs no database, but
catalog, auth, and admin flows need PostgreSQL with all migrations applied.

### 2. Start infrastructure and migrate

```sh
cp infra/.env.example infra/.env
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml up -d --wait postgres
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml run --rm migrator
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.ports.yaml run --rm migrator validate
```

The `compose.ports.yaml` overlay publishes PostgreSQL on loopback-only
`127.0.0.1:5433` so host-side tooling (Reylo type analysis, tests,
production build) can reach the migrated database. The base Compose file
alone intentionally exposes no database port.

Email-dependent flows (sign-up verification, password reset) need an SMTP
server. For local development, point the `SMTP_*` values at Mailpit:

```sh
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Without a reachable SMTP server the app still starts and public discovery
works, but verification and reset emails fail at send time. Inspect
captured mail at `http://localhost:8025`.

### 3. Install, develop, verify

```sh
bun install --frozen-lockfile
export DATABASE_URL="postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney"
bun run dev
```

Open `http://localhost:3000`.

```sh
bun run check        # format + lint + Reylo-aware typecheck (needs DATABASE_URL)
bun test tests/      # unit + integration (needs the migrated database)
bun run build
bun run start
```

The default production build targets Bun. For Node, rebuild with `bun run build:node` and then run `bun run start:node`. Both outputs use `.output/`, so rebuilding replaces the previous target. Configure the listening address with `HOST` and `PORT`.

Create the first administrator directly (shell + DB access required; not
reachable over HTTP — the account is created verified and granted the
protected owner role):

```sh
bun scripts/create-admin.ts admin@example.com 'strong-password-min-12-chars'
```

### Fully containerized dev loop (optional)

`bun run dev:docker` starts the whole stack from one command — Vite dev
server with hot reload (bind-mounted source), PostgreSQL, the one-shot
Flyway migrator (the app waits for its successful exit), and Garage:

```sh
bun run dev:docker
# → app on http://localhost:3000
```

Only the application port is published, bound to loopback
(`127.0.0.1:3000`). PostgreSQL, Garage, and the migrator stay on the
internal Compose network; host tooling keeps using `infra/compose.ports.yaml`
as before. If port 3000 is occupied, set `APP_DEV_PORT=3001` in `infra/.env`
and set `BETTER_AUTH_URL=http://localhost:3001` in the root `.env`, then open
`http://localhost:3001`. OAuth callback URLs must match the chosen base URL.
The container entrypoint pre-warms Vite's cold module graph, so
the first browser load is fast (without the warmup, a cold dev server can
exceed Bun.serve's default 10 s request timeout once and answer 500 — just
retry). Stop with `Ctrl+C`, or
`docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.dev.yaml stop`
(`down` also works; named volumes keep the database).

## Routes

- `/dishes`, `/dishes/$dishId` — public catalog search and detail, with canonical dish IDs carried into restaurant search.
- `/restaurants`, `/restaurants/$venueId` — independent public restaurant search, optional map/geolocation, branch menus, exact observed prices and optional dated currency equivalents.
- `/scan` — guest-accessible multilingual menu scanner: private photo upload, Muse structured extraction, customer corrections, dish/variant/quantity selection with exact subtotals, and a bilingual waiter-facing order card. Optional `menu-facts-v1` contribution sends the saved revision to curator review; approved facts enter the relational menu/price model.
- `/admin/restaurants` — RBAC-protected venue and menu entry, structured source imports, offering retirement and separate price/serving review.

- `/` — public landing page: dish discovery plus an in-place food chooser (one-click quick find or Surprise with windowed pool variety, constraints preserved, provider bypassed; 5-step refinement with auto-advance on answer and a Back button; server-filtered country select; deterministic fallback labeled honestly; opt-in device-local preference memory). English default, `?lang=` switch; the globe menu offers fully translated English and Vietnamese, other locales fall back to English; validated by Zod; no cookie persistence.
- `/dishes/$dishId` — public canonical dish detail (names, ingredients with uncertainty wording, cuisines/categories, associated places, sources, freshness), linkable by slug or decimal id.
- `/saved` — member saved dishes (server-verified session; paged list with batch-loaded details).
- `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email` — Better Auth email + Google/Facebook OAuth (email delivery required for verification and reset; see Mailpit setup above).
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

Integration tests run against a disposable PostgreSQL database (refusing non-loopback targets), migrate it with Flyway, then exercise auth, RBAC, catalog, curation, favorites, and import journeys end to end. Test environment defaults are preloaded before any test module evaluates (`bunfig.toml` `[test] preload`), so file order cannot affect initialization. SQL typechecking (`bun run typecheck`) requires the migrated development database via `DATABASE_URL` (Reylo content mapper); `bun run check` covers format, lint, and types.

## Infrastructure

- One-shot Flyway migrator (`infra/compose.yaml`) applies reviewed `db/migrations/*.sql` before app startup; migrations are immutable once applied — add forward files only.
- Garage provides private S3-compatible object storage for local development; Postgres owns metadata and access policy.

Source references are collected in `docs/references.md`.
