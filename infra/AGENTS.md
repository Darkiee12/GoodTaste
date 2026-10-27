# Infrastructure-specific agent rules

Applies to `infra/` in addition to repository root `AGENTS.md`.

1. Read `docs/infra/overview.md`, `docs/infra/operations.md` and the service-specific runbook before changes.
2. Changes to production topology, public ports, secrets, bucket ACL, persistent volumes or service versions need coordinator review and an ADR check.
3. Local containers bind to loopback. No data-destructive commands, volume deletions, public ACLs, or remote deployment without human approval.
4. Validate compose syntax and report results; never imply Docker was run if it wasn't.
5. Production object-storage topology is undecided. Garage's single-node setup is local-only; preserve any old MinIO volumes during migration.
6. Read `docs/infra/migrations.md` and `docs/infra/postgres.md` before editing `infra/compose.yaml` or running Flyway. Flyway is a one-shot migration job, not a permanent service. The migration SQL directory is read-only in the container.
7. A production deployment must run exactly one approved, version-matched Flyway job and gate the app rollout on its successful completion. `docker stack deploy` does not honor Compose startup ordering. Never automatically call `clean` or `repair`.
8. Keep runtime app DB credentials separate from schema-changing migrator credentials in production. The bootstrap local Compose credentials are not a production access policy.
