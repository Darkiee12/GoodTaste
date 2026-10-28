# Recommendations (implemented)

**Status: Implemented** on PR #3 (`feat/food-discovery`). Public,
session-optional dish recommendations: deterministic eligibility plus
optional Muse re-ranking. The database owns facts; Muse only orders
already-eligible candidates.

## Pipeline

```text
preferences (Zod at transport)
  |
  v
exclusion resolution (IngredientRepository.resolveByKey)
  |  unknown allergy -> Uncertain (no dishes)
  |  unknown dislike -> warning + ignore
  v
candidate SQL (published only, cuisine/country filters, NOT EXISTS
ingredient anti-join, stable id order, LIMIT 60)
  |  zero rows -> Empty (with reasons)
  v
deterministic rank (cuisine +2, meal category +1, stable id order; cap 10)
  |
  +--> MODEL_API_KEY set? --no--> Ready(deterministic, note)
  |
  +--> Muse structured ranking (single bounded call, 15 s timeout)
         valid -> Ready(ai) | invalid/timeout/error -> Ready(deterministic, warning)
```

No transaction is held across the model call: queries complete first and
result cards hydrate from the already-fetched candidate rows.

## Eligibility is deterministic; ranking may be probabilistic

Hard constraints (published status, cuisine/region match when requested,
ingredient exclusions) run in SQL before Muse ever sees a candidate. Soft
signals (mood, variety, occasion fit) only influence ordering.

Allergy inputs are strict: an unresolvable allergy term produces
`Uncertain` with reasons and no dishes. Resolved allergies are hard
exclusions, plus every allergy response carries the warning that
ingredient data may be incomplete and is not an allergy guarantee.
Dislikes are lenient: unresolvable terms are ignored with a warning.

## Muse integration (`src/server/integrations/meta-client.ts`)

- Provider: Meta Model API, `POST {baseUrl}/chat/completions`,
  `MODEL_MODEL_ID` (default `muse-spark-1.3`), `MODEL_BASE_URL`
  (default `https://api.meta.ai/v1`).
- Structured output: `response_format: {type: "json_schema"}` with the
  minimal `{ranked_candidate_ids: string[]}` contract
  (`additionalProperties: false`, `required` set). Candidate IDs are
  never injected as schema enums.
- The prompt contains candidate IDs + names + ranking metadata only: no
  user identity, sessions, email, or admin metadata. Candidate
  names/descriptions are treated as untrusted text, never instructions.
- Business validation is server-side in the operation, not the client:
  every ID must belong to the candidate set, no duplicates, at most 10,
  non-empty when candidates exist. Any violation falls back to
  deterministic order and is reported as `mode: "deterministic"`.
- No retries (single attempt), `AbortSignal.timeout` (default 15 s),
  no key/payload logging. All secrets stay in server-only `MODEL_*`
  env vars; without `MODEL_API_KEY` the pipeline runs deterministically
  with an explicit note (never mislabeled).

## Transport

`recommendDishesFn` (POST, Zod-validated, public): `{mode, dishes,
warnings, reasons}` where mode is `ai | deterministic | uncertain |
empty`. `dishes` reuse the published `DishSummary` card projection —
no draft content, no internal notes, no new DTO. Uncertain/empty return
HTTP 200 with reasons and zero dishes (an honest empty, not a fake
success); invalid input is a Zod 400.

## Tests

`tests/integration/recommendation.test.ts` (fake `MetaClient` via Layer —
no live calls, no API spend): eligibility, hard exclusions, unknown
allergy/dislikes, fake-AI ordering + hydration + shape validation (bad
IDs, dupes, over-limit, malformed, empty), 13 failure/timeout/auth
fallbacks, deterministic baseline properties. `tests/unit/
meta-schema-parity.test.ts` pins the transport vocabularies and the
provider-schema/codec contract.
