# GoodTaste — Coding Agent Instructions

This file is the mandatory repository entry point for coding agents. It is not a replacement for domain documentation. Read the documents indicated for your task before editing. If required files have not been created yet, report that rather than inventing their contents.

## Mission and scope
GoodTaste is a mobile-first full-stack application that helps travellers (1) discover culturally relevant dishes, (2) find verified places that serve them, and (3) understand unfamiliar menus and prepare bilingual orders. Dietary requirements and uncertainty are first-class concerns. Read `docs/product/vision.md` and `docs/product/mvp.md` for acceptance criteria.

## Stack and architectural decisions
- Modular monolith: TanStack Start (React) with server functions; Effect for application operations; PostgreSQL for relational truth; an S3-compatible object store, using MinIO in local development. No separate HTTP backend in the MVP.
- Bun is the initial package manager and proposed runtime; validate build/production compatibility before making it mandatory. See `docs/decisions/0004-bun.md`.
- Treat `docs/decisions/` as the source of recorded architecture decisions, and `docs/architecture/` as their living implementation contracts.
- Database entities and object metadata are not interchangeable: Postgres owns metadata/permissions; object storage holds binary files.
- Treat AI-generated food, allergy, ingredient, and restaurant claims as unverified unless supported by evidence. Never fabricate menu listings, prices, or dietary guarantees.

## Required reading (load only what is relevant)
1. All tasks: `docs/README.md`, `docs/agents/workflow.md`, `docs/agents/definition-of-done.md`.
   Frontend work, UI reviews, prototyping, or module design: use the [skill routing guide](docs/agents/skills.md) to load only the relevant skill.
2. Infra, secrets, deployments: `docs/infra/overview.md`, `docs/infra/operations.md` and relevant service runbook.
3. Data or migrations: `docs/architecture/data-model.md`, `docs/infra/postgres.md`.
4. Uploads, photos, review images: `docs/infra/object-storage.md`, `docs/architecture/trust-and-safety.md`.
5. Frontend/server functions/Effect: `docs/architecture/overview.md`, `docs/architecture/effect.md`, `docs/architecture/contracts.md`.
6. AI recommendations or menu analysis: `docs/architecture/trust-and-safety.md`, `docs/architecture/contracts.md`.
7. Architecture change: review relevant `docs/decisions/` and propose an ADR before implementing breaking changes.

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

This project vendors external repositories under @repos/

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under @repos/ unless explicitly asked
- Do not import from @repos/ - application code should continue importing from normal package dependencies