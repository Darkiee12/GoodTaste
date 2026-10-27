# Deepen a module without inventing a framework

Prefer business capability behind a small interface rather than many shallow wrappers. Classify the dependency:

- **Pure in-process:** consolidate code and test deterministic outcomes directly.
- **Local substitute available:** use a faithful local/test implementation (e.g. disposable Postgres or fake object metadata) when it matches observable behavior.
- **Remote but application-owned boundary:** use an adapter and validate its contract with integration tests (AI, Places, S3).
- **Truly external:** mock only at the edge or use controlled fixtures; never pretend a mock proves the provider behavior.

Keep test-only seams private when possible. A production interface must exist for caller benefit or a meaningful substitution, not merely to allow mocking a method.

Tests should assert what the module promises, including errors and provenance, rather than private implementation ordering.
