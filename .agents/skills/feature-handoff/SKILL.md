---
name: feature-handoff
description: Prepare or audit an isolated GoodTaste feature task or pull request for another coding agent, including ownership, acceptance criteria, tests, integration and handoff.
---
# Feature handoff skill

1. Read `docs/agents/workflow.md` and `docs/agents/task-template.md`.
2. Declare exact write-owned paths, read-only dependencies and base commit.
3. Read feature-specific architecture and trust/data docs.
4. Identify contract producers and consumers; escalate unapproved changes before coding.
5. Test smallest relevant behavior and affected end-to-end flow.
6. Hand back changed paths, checks run with results, migration/ADR changes, blockers and risks.

Never claim ownership of a path assigned to another concurrent writer.
