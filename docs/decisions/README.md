# Architecture decisions

Decisions are recorded when a choice materially affects the repository's engineering contract or operating model.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-sql-first-flyway.md) | Accepted for the scaffold | PostgreSQL-first typed SQL with Reylo, Flyway-owned migrations and a separate pre-deployment migration job |

| [0002](0002-postgis-and-maplibre.md) | Accepted for scaffold | PostGIS restaurant spatial search; MapLibre React maps and separate tile provider |
| [0003](0003-garage-local-s3.md) | Accepted for local development | Garage replaces MinIO behind the S3 boundary; private single-node storage |

Previous references to other ADR numbers in this scaffold are not proof those documents have been written. Do not fabricate approvals for missing decisions; create an ADR when a real decision is reviewed.

ADR template: context → decision → alternatives → consequences → migration/rollback considerations → unresolved questions. Update `docs/README.md` and affected canonical architecture/infra contracts when an ADR changes.
