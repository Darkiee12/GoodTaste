# GoodTaste Documentation Index

**Read this first.** Docs express design intent; `AGENTS.md` expresses agent behavior. Each file has a narrow owner and purpose. Avoid duplicated rules.

## Product
- [Vision](product/vision.md): users, workflows, value proposition, explicit safety boundaries.
- [MVP delivery](product/mvp.md): 10-day scope, acceptance outcomes, deliberate exclusions.

## Architecture
- [System overview](architecture/overview.md): request flow and dependency boundaries.
- [Contracts](architecture/contracts.md): shapes and ownership of cross-team APIs.
- [Data model](architecture/data-model.md): conceptual entities and provenance.
- [Effect conventions](architecture/effect.md): typed effects and adapter practices.
- [Trust and safety](architecture/trust-and-safety.md): food claims, privacy, media and AI risks.

## Infrastructure
- [Infra overview](infra/overview.md): local/production topology and responsibilities.
- [PostgreSQL](infra/postgres.md): persistence, migrations, backups, restore.
- [Object storage](infra/object-storage.md): images, S3 API, security, retention.
- [Environment](infra/environment.md): configuration and secret handling.
- [Operations](infra/operations.md): local runbook and smoke checks.

## Agent coordination
- [Workflow](agents/workflow.md): agent roles, worktree coordination, shared files.
- [Definition of done](agents/definition-of-done.md): measurable completion criteria.
- [Task template](agents/task-template.md): copy for assignments.

## Decision log
- [ADR index](decisions/README.md): recorded architectural choices.

## Reference material
- [Sources](references.md): canonical external documentation and researched repositories.

## Documentation update rule
Change the canonical document for a concern. Update links and decisions if a contract changes. Do not add speculative files that nobody will read. If a statement is not yet verified, label it `Proposed` or `Unverified`.
