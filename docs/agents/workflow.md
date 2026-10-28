# Agent workflow

How coding agents coordinate on FeastJourney without overwriting each other.

## Roles

- **Coordinator** owns integration: task assignments, shared files, worktree/branch merges, and final verification. Only the coordinator merges and pushes.
- **Feature agents** implement one task within explicitly assigned file ownership. They never edit files outside their assignment.
- **Reviewers** (human or agent) verify behavior against this document and `definition-of-done.md` before merge.

## Before editing

1. Read `AGENTS.md` plus the docs listed for the task. Report missing files instead of inventing their contents.
2. Inspect `git status`, the current branch, and recent commits. Use an isolated branch or worktree for parallel write tasks; never have two agents edit the same file in parallel.
3. Declare owned paths, read-only dependencies, expected contracts, tests, and acceptance criteria (see `task-template.md`).

## While editing

- Respect dependency direction: route/UI → application operation → provider/repository interface → infrastructure adapter.
- Server functions validate every external input and authorize protected operations at the server boundary; route guards are navigation hints, not authorization.
- Prefer purpose-specific SQL and Reylo-inferred types; no mirror DTOs or mechanical mappers (`docs/development/code-style.md` §9–10).
- Run `bun run check` (format, lint, Reylo-aware typecheck) before describing work as ready. Run affected tests with `bun test tests/`; report what was not executed.
- Do not overwrite another agent's changes. Shared contracts, schema changes, and common configuration require coordinator approval before work starts.

## Finishing

- Leave work uncommitted unless the coordinator asked for a commit; never push, force-push, merge another agent's branch, or change production access.
- Report: files changed, contracts affected, commands run and results, risks, docs updated, remaining work.
