# Infrastructure baseline

## Environments

- **Local:** a TanStack Start app process (future scaffold), PostgreSQL 18 + PostGIS 3.6 (AMD64-compatible host required), one-shot Flyway migrator, and a local S3-compatible MinIO sample for development only. AI/Places integrations run behind server-only adapters.
- **Preview / CI:** disposable Postgres 18 initialized through the same Flyway history; synthetic fixtures; isolated object-store test bucket or fake. Once Reylo SQL imports exist, CI must typecheck against the migrated live schema.
- **Production:** app release behind HTTPS, separately orchestrated **one-shot Flyway deployment job**, managed/backed-up PostgreSQL with restricted app credentials, and a maintained S3-compatible object service. Legacy MinIO CE is not approved for production.

## Ownership

- **Relational data:** PostgreSQL; database schema changes only via reviewed `db/migrations/` Flyway scripts. PostgreSQL 18 is the **local baseline**, not a claim that a production image/patch has been selected.
- **Query typing:** Reylo `.sql` files owned by each domain; runtime queries use a driver/pool supplied by Effect.
- **Binary files:** object storage holds blobs; private metadata/permissions in PostgreSQL.
- **Secrets:** local `infra/.env` is uncommitted; deployment secrets are injected and rotated. Production Flyway identity (DDL) and app identity (DML only) must be separate.
- **Networking:** DB/object endpoints internal by default; existing Compose publishes **no host ports**. A network-local type checker or explicitly authorized loopback-only DB mapping is required for host-side live Reylo analysis.

## Local topology

```text
PostgreSQL 18 health check ─→ Flyway one-shot migrator ─→ success (exit 0)
           ▲                                                 │
           │                                                 ▼
           └──────── TanStack Start + Effect server (future container)
                           │
                           ├─→ Reylo typed SQL
                           ├─→ AI / Places
                           └─→ S3-compatible object store

Browser ⇄ TanStack Start (HTTP/React/server functions)
Browser ⇄ short-lived pre-signed S3 URL (only when implemented)
```

The application runs **without Flyway as a runtime dependency**; migration deployment is a prerequisite. The one-shot container is not a continuously running service.

## Production rollout gate

1. Backups/restore readiness and backward-compatibility review.
2. Exactly one release-specific Flyway job (DDL-scoped credentials); await success and log applied versions.
3. Only then roll out new app image/replicas (restricted DML credentials).
4. Validate service health and DB error/lock/query metrics; halt release on migration failure.

Docker Compose's `service_completed_successfully` is useful **locally**, but not a substitute for a CI/CD rollout gate in Swarm. Do not run Flyway in every web replica or run destructive DDL during application startup.

## Non-goals

No public Postgres or MinIO console, Kubernetes, Redis, multi-process services, permanent migration daemon or queue until justified. No extra ORM/schema DSL merely for migrations.

## Production readiness

TLS and internal networking, secret rotation, distinct DB roles, backup + restore drill, object retention/deletion controls, quotas and rate limits, provider budget guardrails, request correlation, health probes, metrics, error alerts and monitored migrations are required.

See [PostgreSQL](postgres.md), [Flyway migration lifecycle](migrations.md), [local operations](operations.md), [environment](environment.md), and [object storage](object-storage.md).
