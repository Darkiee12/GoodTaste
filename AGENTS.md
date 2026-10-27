# GoodTaste — Coding Agent Instructions

This file is the mandatory repository entry point for coding agents. It is not a replacement for domain documentation. Read the documents indicated for your task before editing. If required files have not been created yet, report that rather than inventing their contents.

## Mission and scope
GoodTaste is a mobile-first full-stack application that helps travellers (1) discover culturally relevant dishes, (2) find verified places that serve them, and (3) understand unfamiliar menus and prepare bilingual orders. Dietary requirements and uncertainty are first-class concerns. Read `docs/product/vision.md` and `docs/product/mvp.md` for acceptance criteria.

## Stack and architectural decisions
- Modular monolith: TanStack Start (React) with server functions; Effect for application operations; PostgreSQL for relational truth; an S3-compatible object store, using Garage in local development. No separate HTTP backend in the MVP.
- Bun is the initial package manager and proposed runtime; validate build/production compatibility before making it mandatory. See `docs/decisions/0004-bun.md`.
- Treat `docs/decisions/` as the source of recorded architecture decisions, and `docs/architecture/` as their living implementation contracts.
- Database entities and object metadata are not interchangeable: Postgres owns metadata/permissions; object storage holds binary files.
- Treat AI-generated food, allergy, ingredient, and restaurant claims as unverified unless supported by evidence. Never fabricate menu listings, prices, or dietary guarantees.

## Required reading (load only what is relevant)
1. All tasks: `docs/README.md`, `docs/agents/workflow.md`, `docs/agents/definition-of-done.md`.
   Frontend work, UI reviews, prototyping, or module design: use the [skill routing guide](docs/agents/skills.md) to load only the relevant skill.
2. Infra, secrets, deployments: `docs/infra/overview.md`, `docs/infra/operations.md` and relevant service runbook.
3. Data, SQL, schema or migrations: `docs/architecture/data-model.md`, `docs/architecture/persistence.md`, `docs/infra/postgres.md`, `docs/infra/migrations.md`, and `docs/development/database-testing.md`. Run migrations as a separate pre-deploy job, never automatically in the Effect server or each replica.
4. Uploads, photos, review images: `docs/infra/object-storage.md`, `docs/architecture/trust-and-safety.md`.
5. Frontend/server functions/Effect: `docs/architecture/overview.md`, `docs/architecture/effect.md`, `docs/architecture/contracts.md`.
6. AI recommendations or menu analysis: `docs/architecture/trust-and-safety.md`, `docs/architecture/contracts.md`.
7. Architecture change: review relevant `docs/decisions/` and propose an ADR before implementing breaking changes.

## Module architecture and access control

Read `docs/architecture/modules.md` and `docs/architecture/access-control.md` before creating any application path, server function, cross-module call, or authentication-sensitive operation.

- Use exactly three foundational domains: `src/modules/user/`, `src/modules/food-discovery/`, and `src/modules/restaurant-discovery/`.
- `src/routes/` is for TanStack pages and external HTTP endpoints; `src/server/` owns shared server-only infrastructure and cross-domain workflows. Do not add a generic `services/` or `packages/` root without a documented reason.
- Public discovery is accessible to guests and members; member-owned actions require verified session identity and ownership checks at **every endpoint/operation**. Do not treat route guards as authorization.
- Cross-module calls use each module's published server-only API; do not import another module's private repository/SQL. Coordinate cycles in `src/server/workflows/`.
- HTTP inputs use Zod 4.6; database SQL uses Reylo's inferred types, without duplicate row parsing. Validate external AI/Places output separately.
- Follow Effect v4 **ADT conventions** for domain cases: `Data.TaggedEnum` + `Data.taggedEnum` constructors, exhaustive `$match`; use `Schema.TaggedUnion` when codecs are needed and `Data.TaggedError` for typed domain failures. Do not invent hand-written `{kind: ...}` unions for `Actor`.
- The `Actor` is constructed from verified server session identity and provided as a per-request `CurrentActor` `Context.Service` requirement (or explicitly passed to a small operation); never store it in a singleton `ManagedRuntime` Layer. See `docs/architecture/domain-modeling.md` and `docs/architecture/access-control.md`.
- Compose Effect v4 operations and layers without creating a parallel HTTP server or storing per-request identity in global runtime state.

## SQL, migrations and release safety

- Restaurant Discovery uses PostGIS 3.6 for geosearch and a browser-only MapLibre GL JS + `react-map-gl/maplibre` React map. Never conflate a basemap/tile provider with restaurant/POI sources. Read `docs/architecture/maps.md` before implementing geolocation or map UI.
- **Flyway** is the sole schema migrator. Put DDL/data migrations in global `db/migrations/`; application `.sql` queries belong to the owning module's `server/repository/sql/` path and are typed through Reylo.
- Prefer direct SQL and small Effect operations over `Controller → Service → Repository` boilerplate. Use repositories when they protect meaningful persistence/transaction contracts; never let transport handlers bypass authorization.
- In local Compose, the one-shot migrator depends on PostgreSQL health; future app containers must await its successful exit. Docker Swarm requires an **external release pipeline gate**, not `depends_on`.
- Production application credentials are distinct from migration credentials. Never change already-applied versioned Flyway files, bypass migration history with `db push`, or treat `repair`/`clean` as normal recovery.
- After the first Reylo `.sql` import, CI must migrate a fresh database **before** checking SQL types/building; an empty migration-history check is not proof that application SQL works.

## Non-negotiable engineering rules
- Respect dependency direction: route/UI → application operation → provider/repository interface → infrastructure adapter. Do not import DB, secrets, or object SDKs into browser code.
- Server functions validate every external input, authorize protected operations at the server boundary, and return explicit client-safe outcomes. Do not expose internal stack traces.
- Do not create abstractions without a second use case or a meaningful external boundary. Prefer small, cohesive features over generic frameworks.
- Avoid `any`, hidden global side effects, swallowed errors, bare magic values, and mutable cross-request state.
- Use Effect for orchestration, typed failures, cancellation, retries, and resource management where valuable. Avoid wrapping every pure function in Effect.
- Changes that cross feature boundaries need documented contracts and an independent reviewer.
- Production secrets are never committed or printed. Never commit `.env`, test user photos, private data, model credentials, or production connection strings.
- Never run destructive database/storage commands, delete volumes, change cloud access policy, deploy, or push without explicit approval.
- Keep UI and API examples consistent with official TanStack/Effect version documentation; verify changed APIs instead of guessing.

## Parallel-agent discipline
- One coordinator owns integration, shared files, task assignments, and merges.
- Every task must declare its owned paths, read-only dependencies, expected contracts, tests, and acceptance criteria (see `docs/agents/task-template.md`).
- Use separate branches or worktrees for parallel write tasks. Do not have two agents edit the same file in parallel.
- Shared contracts, schema changes, common configuration, and cross-cutting changes require coordinator approval before work starts.
- Do not overwrite another agent's changes. If overlap is unavoidable, pause the conflicting task and report the contract gap.

## Verification and reporting
- Before editing: inspect the existing repository, relevant docs, and existing conventions. Never assume a path exists from this blueprint alone.
- Execute only commands actually present in `package.json` or `Makefile` after application scaffold is created; do not invent test command names.
- Target checks: format/lint, typecheck, unit tests, affected integration tests, and build. Infrastructure: `docker compose config` and explicit smoke tests.
- If tooling or tests are unavailable, report exactly what is blocked; never claim checks passed without running them.
- Final report must include changed paths, contracts affected, commands run and results, risks, docs updated, and remaining work.

## Pull requests
Prefer small PRs scoped to one feature/contract. Include objective, affected files, architecture implications, verification evidence, risks and rollback plan. No silent migrations or breaking API changes. See `docs/agents/definition-of-done.md`.

## Vendored Repositories

This project vendors external repositories under `repos/`

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under `repos/` unless explicitly asked
- Do not import from `repos/` - application code should continue importing from normal package dependencies
## Quality gates

When you edit application code, read `docs/development/quality-gates.md`, then run `bun run check` before describing the work as ready. Never lint, format, type-check or modify `repos/effect/`; vendored libraries are reference-only. Run relevant behavior/browser tests if they exist, and report what was not executed.
