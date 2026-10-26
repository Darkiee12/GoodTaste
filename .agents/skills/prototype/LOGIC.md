# GoodTaste logic prototypes

Use this when a user-facing state model needs to be felt through interaction.

1. Define one falsifiable question (e.g. 'Can verification status move from unknown to supported without incorrectly implying allergy safety?').
2. Model the smallest pure reducer, state machine, or set of deterministic functions for that question.
3. Create a standalone local HTML demonstration with explicit states, actions, current outcome and explanation. This is a temporary review artifact, not a production route.
4. Exercise realistic negative cases: missing metadata, conflicting ingredients, restaurant out of range, photo processing timeout, location refused, order language not supported.
5. Use only synthetic local data and no live effects, credentials, network, or persistence.
6. Record the discovered domain decision in the canonical architecture/contract docs, then remove the demo from the production bundle.

Don't expand the prototype into a framework or test suite. Actual production code must subsequently have automated tests for its contracts.
