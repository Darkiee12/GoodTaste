# Design it twice — GoodTaste

Use for decisions that affect multiple feature agents or cross a provider/data boundary.

1. Frame constraints and define the behavior each candidate must preserve. Include trust, cost, error handling, and 10-day scope.
2. Ask independent agents for contrasting solutions: **minimal call surface**, **flexible extension**, and **optimized for the common user journey**. Add a provider-boundary candidate where needed.
3. Compare each using the same concrete scenario and a missing/contradictory-data failure case.
4. Document pros, cons, surface area, testability, dependency risks, and agent ownership.
5. Select one option; record the contract in `docs/architecture/contracts.md` and an ADR if the decision is architectural.

Do not use this workflow on trivial helper functions or consume several agent sessions debating hypothetical future integrations.
