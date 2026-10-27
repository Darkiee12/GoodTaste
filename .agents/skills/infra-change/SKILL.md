---
name: infra-change
description: Plan or modify GoodTaste PostgreSQL, Docker Compose, object storage, environment configuration, operations runbooks, and deployment safety. Use for all infrastructure changes.
---
# Infra change skill

1. Read `AGENTS.md`, `docs/infra/overview.md`, and the relevant service runbook.
2. Determine local/preview/production scope and check existing ADRs.
3. Enumerate ports, stateful volumes, data/secrets, migration compatibility and rollback.
4. Obtain coordinator agreement for shared contracts; require human confirmation for public access, destructive operations or remote deployments.
5. Make the smallest change in assigned paths and update canonical docs.
6. Validate with `docker compose config` when available; smoke test without destroying data.
7. Report exact verification evidence, image provenance/support status and any unverified assumptions.

## Hard constraints
No public database/object-store admin endpoint, default public bucket, production use of legacy MinIO without reviewed ADR, or silent wipe of volumes.
