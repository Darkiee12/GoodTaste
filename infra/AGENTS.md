# Infrastructure-specific agent rules

Applies to `infra/` in addition to repository root `AGENTS.md`.

1. Read `docs/infra/overview.md`, `docs/infra/operations.md` and the service-specific runbook before changes.
2. Changes to production topology, public ports, secrets, bucket ACL, persistent volumes or service versions need coordinator review and an ADR check.
3. Local containers bind to loopback. No data-destructive commands, volume deletions, public ACLs, or remote deployment without human approval.
4. Validate compose syntax and report results; never imply Docker was run if it wasn't.
5. Production object-storage provider is undecided. Legacy MinIO sample is local-only.
