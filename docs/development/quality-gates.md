# Code quality and checks

FeastJourney uses **Oxlint (type-aware)**, **Oxfmt**, and TypeScript. These are application-code gates, not checks of the third-party Effect source vendored in `repos/effect/`.

## Commands

```bash
bun install
bun run format       # Check formatting
bun run lint         # Built-in TypeScript, React, import and selected anti-slop rules
bun run check-types  # TypeScript no-emit validation
bun run check        # All of the above, in that order
bun run fmt          # Explicitly rewrite formatting; review resulting diff
bun run lint:fix     # Explicitly apply safe lint auto-fixes; review diff
bun run audit        # Dependency CVEs, AI slop, React Doctor, React Compiler readiness
```

**Lockfile:** `bun.lock` is committed and current. CI installs with `bun install --frozen-lockfile` for reproducible dependency resolution; after changing `package.json`, run `bun install` locally and commit the resulting `bun.lock` update.

## Quality gate

1. Formatting must pass; reviewers require predictable diffs from independent agents.
2. Oxlint reports no diagnostics at `--max-warnings 0`. Built-in rules enforce async safety, unsafe TypeScript operations, React hooks/compiler practices, and correct import behavior.
3. TypeScript must check **FeastJourney** paths only. The current app `tsconfig.json` explicitly includes `src/**`, `tests/**` and `vite.config.ts` and excludes `repos/**`.
4. Two vendored **SCUtilities** anti-slop rules enforce no chained assertions and no widen-then-assert patterns. Their source lives under `tools/oxlint/anti-slop/`.
5. For visible UI changes, additionally inspect narrow mobile and desktop viewports, keyboard interaction, camera-denied/manual fallback, bilingual names, loading/error/empty states, and ingredient uncertainty. Use the existing browser and accessibility skills. Automated lint is not a replacement for this.
6. For any feature with established tests, run its existing focused unit/integration/browser tests. Do not invent a passing test command before the test suite exists.
7. Do not claim a build, test suite, browser walkthrough, or CI has passed until it has actually executed.

## Audit tier (`bun run audit`, CI `audit` job)

Four read-only audits complement oxlint. Tool versions are pinned in `package.json`, not floating `latest`.

- **Dependencies** (`audit:dependencies` → `bun audit`): fails on known CVEs. A `tinypool` override in `package.json` pins the transitive fix oxfmt's range blocks; re-check the override whenever oxfmt is upgraded.
- **AI slop** (`audit:slop` → `bunx aislop@0.18.1 ci`): errors-only gate over application code (see `.aislop/config.yml`, which excludes vendored `repos/`). Known accepted warnings: dish-data duplication shape in `food-locations.ts` (data tables legitimately repeat; a shared helper would reintroduce the lat/lon positional footgun the `Latitude`/`Longitude` brands eliminate).
- **React Doctor** (`audit:react-doctor`): error-gated with telemetry and supply-chain scans off. `doctor.config.json` downgrades the hydration-branch rule to warn: the globe's reduced-motion branch only renders inside a `ClientOnly` boundary, so it can never hydrate on the server.
- **React Compiler readiness** (`audit:react-compiler`): informational today — the compiler is not adopted. Keep it green so adoption stays a one-step decision.

## Scope

`repos/effect/**`, agent skill material, generated output and `node_modules/**` are excluded from Oxlint/Oxfmt. Keep the vendored source read-only; install actual runtime packages through normal dependencies. When FeastJourney adds generated route types, generate them before type-aware lint and `tsc`, just as the TanStack dashboard does in SCUtilities.

## Required change review

PR description should state: behavior changed, contracts touched, quality commands run and their results, mobile/browser evidence for UI work, trust and provenance implications for AI/restaurant facts, and unverified risks.

A green static check is necessary, not proof of correct food information, accessible UX, or safe dietary conclusions.

## Database migration job (implemented)

The `Quality` workflow's `PostgreSQL 18 + Flyway` job checks Compose
configuration without printing expanded secrets, starts disposable PostgreSQL,
runs `migrate`, verifies the PostGIS extension with a real spatial function,
runs `validate`, and repeats `migrate` to exercise an idempotent no-op pass.

The `Quality` workflow also has a `backend` job that provisions the same
disposable database with a loopback port, runs all Flyway migrations in
version order, then runs the Reylo-aware typecheck, the full test suite
(unit + PostgreSQL integration + HTTP + rate-limit), and the production
build against that migrated database. A green `backend` job proves schema
compatibility, query typing, and runtime behavior together; the standalone
`migration` job continues to verify Compose wiring independently.

See `docs/development/database-testing.md`, `docs/infra/migrations.md` and `docs/architecture/persistence.md` for acceptance scenarios.
