# Definition of done

A task is done when all of the following hold. Partial completion is reported as such — never claimed as done.

## Functionality

- Acceptance criteria from the task assignment are met with real application behavior (no mock implementations standing in for persistence, authorization, or validation).
- Protected operations enforce authentication, database permission checks, and ownership/domain policy at the server boundary; route guards alone do not count.
- Imported or AI-derived food claims are traceable to evidence; nothing fabricates menu listings, prices, or dietary guarantees.

## Quality gates (all executed, not assumed)

- `bun run check` passes: `oxfmt`, `oxlint --max-warnings 0`, Reylo-aware `tsc` against a migrated database.
- `bun test tests/` passes for the full suite (or the affected subset plus a stated reason).
- `bun run build` succeeds; Flyway `validate` passes with no pending migrations.
- No new `any`, no swallowed errors, no hardcoded secrets, no unrelated drive-by edits.

## Review readiness

- Small, scoped diff: one feature/contract per PR, no silent migrations or breaking API changes.
- Tests cover the new behavior including failure paths (validation rejections, authorization denials, concurrency where applicable).
- Docs updated for changed contracts: module READMEs, migration README entries for new DDL, and architecture notes for new cross-feature behavior.
- Final report states: branch and commits, files and contracts changed, verification evidence with command output, risks and rollback plan, remaining work.
