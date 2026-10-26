---
name: contract-review
description: Review cross-feature interfaces, Effect service boundaries, domain models, schema changes, AI-derived food evidence, and storage contracts before parallel implementation or merge.
---
# Contract review skill

1. Read `docs/architecture/overview.md`, `docs/architecture/contracts.md` and affected ADRs.
2. List the producer/consumer, data ownership, authorization, failure outcomes and retries.
3. Verify AI claims preserve evidence and uncertainty; verify server/client separation.
4. Check whether this is a breaking change for parallel agents, migrations or stored data.
5. Produce a concise review: accepted invariants, gaps, risks, tests and required ADR edits.
6. Do not edit shared contracts from a read-only review role; send the proposal to coordinator.
