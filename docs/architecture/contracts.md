# Cross-module contracts

A module exposes only the smallest necessary public server operations through `src/modules/<module>/server/index.ts`. Other modules and workflows must not import its private repository, SQL, or operations implementation files.

Direct one-way calls are permitted; cyclic dependencies are not. A workflow under `src/server/workflows/` coordinates use cases spanning Food Discovery, Restaurant Discovery and User. Domain modules do not need a wrapper interface for every simple function; use meaningful Effect services at external/resource boundaries.

**Core example:** Food Discovery returns dish identities and food details; Restaurant Discovery takes identifiers/criteria and returns places plus *sourced serving evidence*; an orchestration workflow combines results, optionally informed by member preferences. It must not turn inferred matches into confirmed restaurant menu facts.

Before implementing a public operation, specify:
- owning module, callers and observable user outcome;
- typed input, result and expected errors;
- whether it is `public`, `member`, or member-owned, and where authorization occurs;
- source/evidence and uncertainty required for restaurant, menu and ingredient claims;
- external dependencies, retries, cancellation, transaction and idempotency behavior;
- one guest/member test and one missing/contradictory-data test when relevant.

Do not expose raw SQL/driver exceptions through RPC. Translate expected Effect failures to client-safe outcomes at the transport edge.

For multi-module atomic writes, the coordinating workflow establishes a single transaction scope and supplies the same transaction-bound client to participating repositories. Each module retains ownership of its data and validation rules.
