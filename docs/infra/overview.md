# Infrastructure baseline

## Environments
- **Local**: one TanStack Start process (to be scaffolded), PostgreSQL, S3-compatible MinIO for development, external AI/Places API behind adapters.
- **Preview/CI**: disposable Postgres + isolated S3-compatible test bucket or in-memory fake; no production data.
- **Production**: application, managed or regularly backed-up Postgres, and a maintained S3-compatible service. MinIO CE is **not approved** for production without an explicit revised ADR and maintenance/security plan.

## Ownership
- Relational data: PostgreSQL 17 development baseline (minor version pinned during implementation review).
- Binary images: object storage, private buckets and Postgres asset metadata.
- Configuration: validated environment variables; secrets injected at deploy, never bundled.
- Network: DB/storage administrative endpoints internal only; local published ports bound to loopback.

## Topology
```text
Browser → TanStack Start (server functions) → Postgres
                                    ↘ AI/Places providers
                                    ↘ S3-compatible storage
Browser ↔ pre-signed upload/download URL (short TTL, restricted key/type)
```

## Non-goals
No public DB, public MinIO console, Kubernetes, separate queue/worker, Redis or CDN until necessary. A scheduler or background cleanup can be added only when data lifecycle requires it.

## Minimum production checklist
TLS on web and storage endpoint, restricted network access, secret rotation, DB backups with restore drill, object backup/retention policy, upload quota, app-level rate limiting, provider budget guardrails, request correlation, metrics, basic alerting and monitored resource use.
