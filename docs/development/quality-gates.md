# Code quality and checks

GoodTaste uses **Oxlint (type-aware)**, **Oxfmt**, and TypeScript. These are application-code gates, not checks of the third-party Effect source vendored in `repos/effect/`.

## Commands

```bash
bun install
bun run format       # Check formatting
bun run lint         # Built-in TypeScript, React, import and selected anti-slop rules
bun run check-types  # TypeScript no-emit validation
bun run check        # All of the above, in that order
bun run fmt          # Explicitly rewrite formatting; review resulting diff
bun run lint:fix     # Explicitly apply safe lint auto-fixes; review diff
```

**Current lockfile caveat:** The toolchain was added to `package.json` via GitHub; this environment cannot execute Bun to resolve the exact package graph or regenerate `bun.lock`. Run `bun install` locally and commit the resulting `bun.lock` update. Until the lockfile is regenerated, the workflow installs with `bun install --no-save` to avoid silently committing an auto-updated lockfile; after regeneration, change CI to `bun ci` for reproducible dependency resolution.

## Quality gate

1. Formatting must pass; reviewers require predictable diffs from independent agents.
2. Oxlint reports no diagnostics at `--max-warnings 0`. Built-in rules enforce async safety, unsafe TypeScript operations, React hooks/compiler practices, and correct import behavior.
3. TypeScript must check **GoodTaste** paths only. The current app `tsconfig.json` explicitly includes `src/**`, `tests/**` and `vite.config.ts` and excludes `repos/**`.
4. Two vendored **SCUtilities** anti-slop rules enforce no chained assertions and no widen-then-assert patterns. Their source lives under `tools/oxlint/anti-slop/`.
5. For visible UI changes, additionally inspect narrow mobile and desktop viewports, keyboard interaction, camera-denied/manual fallback, bilingual names, loading/error/empty states, and ingredient uncertainty. Use the existing browser and accessibility skills. Automated lint is not a replacement for this.
6. For any feature with established tests, run its existing focused unit/integration/browser tests. Do not invent a passing test command before the test suite exists.
7. Do not claim a build, test suite, browser walkthrough, or CI has passed until it has actually executed.

## Scope

`repos/effect/**`, agent skill material, generated output and `node_modules/**` are excluded from Oxlint/Oxfmt. Keep the vendored source read-only; install actual runtime packages through normal dependencies. When GoodTaste adds generated route types, generate them before type-aware lint and `tsc`, just as the TanStack dashboard does in SCUtilities.

## Required change review

PR description should state: behavior changed, contracts touched, quality commands run and their results, mobile/browser evidence for UI work, trust and provenance implications for AI/restaurant facts, and unverified risks.

A green static check is necessary, not proof of correct food information, accessible UX, or safe dietary conclusions.

## Database migration job (scaffold phase)

The `Quality` workflow now also has an independent `PostgreSQL 18 + Flyway` job. It checks Compose configuration without printing expanded secrets, starts disposable PostgreSQL, runs `migrate`, runs `validate` and repeats `migrate` to exercise an idempotent no-op pass.

The migration folder intentionally contains no schema DDL yet; a green migration job demonstrates **container wiring and migration history**, not actual user/dish/restaurant schema compatibility. Once the first Reylo `.sql` import or app repository lands, integrate migrations and Reylo typecheck/build **in the same CI job or against the same migrated database**; separate jobs do not share their ephemeral Postgres. Do not treat a cached `.reylo/` result as authoritative CI verification.

See `docs/development/database-testing.md`, `docs/infra/migrations.md` and `docs/architecture/persistence.md` for acceptance scenarios.
