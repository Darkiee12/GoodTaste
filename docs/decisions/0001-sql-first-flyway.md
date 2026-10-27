# ADR 0001 — SQL-first PostgreSQL with Reylo and Flyway

- **Status:** Accepted as the FeastJourney scaffolding design
- **Date:** 2026-10-27
- **Scope:** Database migrations, typed application queries, schema ownership, release ordering

## Context

FeastJourney is a TanStack Start + Effect v4 modular monolith with three foundational domains: User, Food Discovery and Restaurant Discovery. We want PostgreSQL-native SQL, direct query ownership in each domain, and reliable type checking without defining a parallel ORM schema. We also need repeatable CI/deploy operations and to avoid each app instance racing to modify the schema.

## Decision

1. **PostgreSQL 18** is the relational baseline in local Compose. Pin an exact minor/patch production image at deployment review.
2. **Flyway CLI/container** owns all schema/database evolution as ordered, reviewed SQL in `db/migrations/`. Versioned applied migrations are immutable, and Flyway's schema history/checksums are authoritative. `flyway/flyway:13.11.1` is the current local/CI image pin.
3. **Reylo** owns typed application `.sql` imports in `src/modules/<domain>/server/repository/sql/`, using TypeScript 7.1 content mappers and the migrated DB schema. `.sql` imports are not migrations.
4. **Zod 4.6** validates HTTP inputs; runtime validation for external AI/provider data happens at the corresponding boundary. Do not create redundant Zod schemas for every Reylo row.
5. **Effect v4** orchestrates application behavior, transaction lifetimes and adapter dependencies. TanStack Start remains the HTTP entrypoint; we do not require `Controller → Service → Repository` class layers.
6. **Flyway runs as a one-shot pre-start job** locally. Production deployments run one controlled migration job **before** app rollout, outside every replicated app process. Compose can gate a future app container via `service_completed_successfully`; Swarm's `docker stack deploy` needs orchestration outside Compose dependencies.
7. **Centralized migrations, distributed query ownership:** schema history is one ordered stream, but each domain owns its SQL/operations. No new `packages/` workspace or global `queries/` dumping ground.

## Alternatives considered

- Prisma Migrate / Drizzle Kit: useful with their schema DSLs, but would introduce a second source of table definitions solely for migrations while the application intentionally uses SQL files.
- Kysely migrator or node-pg-migrate: reasonable alternatives, but less value than a standalone SQL-first migration CLI for this repository's separation of concerns.
- Flyway invoked by the application at boot: rejected; startup needs only a compatible schema and restricted app credentials. Replicated instances and rolling deploys must not each attempt migration.
- Ad hoc `psql` scripts: rejected as the sole production migration process due to missing applied-version/checksum tracking.
- Per-domain independently numbered migrations: rejected because a database has global integrity constraints and cross-domain foreign keys.

## Consequences

- Local onboarding adds one Flyway image and an ordered migration directory.
- CI/deploy must provision Postgres, migrate/validate schema, then run Reylo type checks, tests and build.
- Operational responsibility includes forward-compatible SQL, backups and rollback planning. Migrator role and application role are separated in production.
- A successful static lint does not establish DB readiness, data preservation, performance or authorization.

## Unresolved and deliberately deferred

- Physical `users`, dishes, restaurants, menus and serving-evidence table designs; auth provider and UUID conventions.
- Production PostgreSQL provider and exact image digest/minor version.
- Runtime SQL driver (`pg`, postgres.js, Bun.sql) and concrete Effect transaction implementation; all must be compatible with Reylo.
- Host access strategy for live dev-schema Reylo analysis while keeping PostgreSQL off public networks.
- Final CI job wiring once actual queries and app image exist.

See [migrations](../infra/migrations.md), [database ownership](../architecture/data-model.md), [persistence](../architecture/persistence.md), [deployment](../infra/overview.md) and [database tests](../development/database-testing.md).
