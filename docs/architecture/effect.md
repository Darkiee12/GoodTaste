# Effect v4 and Reylo conventions

TanStack Start owns HTTP. Effect v4 is the application backend toolkit, **not a second HTTP server**.

- Use `Effect.gen` for readable orchestration and `Effect.fn` for named reusable effects where tracing helps. Consult vendored `repos/effect/LLMS.md` and current package source for exact APIs.
- Use `Context.Service` and `Layer` for real capabilities with lifetimes or replaceable implementations (PostgreSQL/Reylo pool, AI provider, Places, object storage), not boilerplate pass-through facades.
- A process-scoped server-only `ManagedRuntime` is composed under `src/server/runtime.ts` and `src/server/layers.ts`; connect it to TanStack endpoints. Dispose scoped resources with server shutdown.
- Do not run a fresh Effect runtime inside every domain function; compose Effect values and run at the HTTP/application integration edge.
- Session actors, request IDs and ownership checks are request-scoped, never mutable singleton layer state. Supply the actor explicitly or through request-scoped Effect context.
- Expected errors use a typed domain vocabulary. Unexpected defects and raw driver errors are logged securely and transformed to safe client responses at the transport boundary.

**HTTP:** Zod 4.6 validates query/form/request data in TanStack server-function or raw HTTP adapters. Server session verification and resource authorization are independent of Zod input parsing.

**SQL:** Flyway (external CLI/container) migrates PostgreSQL **before** the app; it never runs inside an Effect service or during every server startup. Reylo's TypeScript 7.1 `.sql` imports infer parameters, results and cardinality against the live PostgreSQL schema. Each module owns its SQL under its `server/repository/sql/`; shared pool, transaction plumbing and migrations belong to `src/server/database/`. Avoid redundant Zod schemas for trusted SQL rows. PostgreSQL constraints and domain invariants remain necessary.

**Other trust boundaries:** AI and external Places data require runtime checking and provenance. Typed SQL does not establish that an AI claim is factual. Never claim verified dietary safety on inference alone.

See `docs/architecture/persistence.md` and `docs/infra/migrations.md` for query ownership, transaction boundary and the release gate.

Reylo type checking needs a schema-available development database (or explicitly supported cached analysis). Keep TypeScript 7.1 content mapper configuration and `--runExternalCode` working. Run migrations before checks once SQL imports exist.

Docs: https://effect.website/docs/v4/runtime · https://effect.website/docs/v4/requirements-management/services · https://reylo.dev/#sql
