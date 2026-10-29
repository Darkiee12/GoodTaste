# Recommendations (implemented)

**Status: Implemented** on PR #3 (`feat/food-discovery`). Public,
session-optional dish chooser embedded in the homepage (`/#recommend`)
plus a minimal public dish
page (`/dishes/$dishId`, slug or numeric id) linked from result cards.
The database owns facts; Muse only orders already-eligible candidates.

## Provider selection (explicit, validated)

`RECOMMENDATION_PROVIDER` (`deterministic` default, or `muse`) plus
`MODEL_*` credentials form one validated configuration, resolved per
request by `resolveRankingConfig` (env parsing itself is cached):

- `deterministic` → deterministic ranking with an honest note. Always available, no credentials needed.
- `muse` + valid key + supported model shape (`muse-spark-<major>.<minor>`
  releases, Standard or `-contributor` tier, plus `muse-wonder-<major>.<minor>`
  releases) + https base URL → Muse ranking
  with deterministic fallback only for transient/provider-output failures.
- `muse` with a missing key, out-of-shape model, or non-https endpoint →
  `Misconfigured`: the request fails closed (HTTP 500, no silent
  deterministic mode, nothing logged but the failure class).

Startup never requires the provider to be online; validation is
offline (shape only).

## Pipeline

```text
preferences (Zod enums shared with the UI via recommendation.constants.ts)
  |
  +--> rate-limit budget ("search" bucket; identity is per-client IP
  |     only when TRUSTED_PROXIES is configured — otherwise all direct
  |     traffic shares one global budget, which is the honest enforced
  |     limit; over budget -> HTTP 429 with Retry-After, provider never
  |     called)
  v
exclusion resolution (IngredientRepository.resolveByKey)
  |  ANY allergy term present -> Uncertain (no allergy filtering: the
  |  catalog has no verified-completeness representation, so no positive
  |  allergy claim is made; the response explains why and what to do)
  |  unresolvable dislike -> warning + ignore
  v
candidate SQL (published only, cuisine filter, ANY-association region
filter — associated, NOT proof of origin; NOT EXISTS ingredient
anti-join; cuisine-match then meal-category-match then stable id ASC;
LIMIT param)
  |  zero rows -> Empty (with reasons)
  v
deterministic rank (cuisine +2, meal category +1; mood has no catalog
signal and only reaches the Muse prompt) with cap 10, then Surprise
windowing when `surpriseSeed > 0` (stable head at seed 0; nonzero seeds
offset into the ranked pool so different eligible dishes surface, with an
honest note and no provider call)
  |
  +--> deterministic / no key -> ReadyDeterministic
  |
  +--> Muse structured ranking (single bounded call, 15 s timeout)
         valid -> ReadyMuse | auth/permanent/misconfigured -> typed
         failure (no fallback) | 429/transient/invalid -> deterministic
         fallback reported as deterministic + warning
```

No transaction is held across the model call: queries complete first and
result cards hydrate from the already-fetched candidate rows.
Model concurrency is bounded by design (one bounded request per
recommendation call, no fan-out).

## Eligibility is deterministic; ranking may be probabilistic

Hard constraints (published status, cuisine/region match when requested,
ingredient exclusions) run in SQL before Muse ever sees a candidate. The
region filter matches ANY geographic association and must be read as
"associated with", never as proof of origin. Soft signals (mood,
variety, occasion fit) only influence ordering.

Allergies always produce `Uncertain` with per-term reasons plus the
incomplete-data warning: without a verified-completeness representation
in the catalog, no positive allergy claim is supportable. Dislikes are
lenient: unresolvable terms are ignored with a warning and resolved
terms become hard SQL exclusions.

## Muse integration (`src/server/integrations/meta-client.ts`)

- Provider: Meta Model API, `POST {baseUrl}/chat/completions`,
  `MODEL_MODEL_ID` (default `muse-spark-1.3`), `MODEL_BASE_URL`
  (default `https://api.meta.ai/v1`).
- Structured output: `response_format: {type: "json_schema"}` with the
  minimal `{ranked_candidate_ids: string[]}` contract
  (`additionalProperties: false`, `required` set, `strict: true`).
  Candidate IDs are never injected as schema enums.
- The prompt contains candidate IDs + names + ranking metadata only: no
  user identity, sessions, email, or admin metadata. Candidate
  names/descriptions are treated as untrusted text, never instructions.
  Prompt injection cannot mint dish IDs: membership is validated
  server-side against the candidate set.
- Business validation is server-side in the operation, not the client:
  every ID must belong to the candidate set, no duplicates, at most 10,
  non-empty when candidates exist. Auth/permanent failures and
  misconfiguration are typed errors with no fallback; rate-limit (429),
  transient (5xx/timeout), and invalid-output failures fall back to
  deterministic order reported as `deterministic`.
- No retries (single attempt), `AbortSignal.timeout` (default 15 s),
  no key/payload logging — only backend, model id, counts, duration,
  and fallback reason. All secrets stay in server-only `MODEL_*`
  env vars; without an explicit `muse` provider selection the pipeline
  runs deterministically with an explicit note (never mislabeled).

## Transport

`recommendDishesFn` (POST, Zod-validated, public): `{mode, dishes,
warnings, reasons}` where mode is `ai | deterministic | uncertain |
empty`. The domain models four variants (`ReadyMuse`,
`ReadyDeterministic`, `Uncertain`, `Empty`) with exhaustive `$match` at
the boundary; the wire keeps the stable four-string shape. `dishes`
reuse the published `DishSummary` card projection — no draft content, no
internal notes, no new DTO. Uncertain/empty return HTTP 200 with reasons
and zero dishes (an honest empty, not a fake success); invalid input is
a Zod 400; over-budget requests get HTTP 429 with `Retry-After`.

## Tests

`tests/integration/recommendation.test.ts` (fake `MetaClient` via Layer —
no live calls, no API spend): eligibility, hard exclusions, allergy
refusals, fake-AI ordering + hydration + shape validation (bad IDs,
dupes, over-limit with seed-independent fixtures, exactly-at-limit
acceptance, malformed, empty), 401/403 auth and permanent failures with
no fallback, 429/transient/invalid-output fallback to deterministic,
misconfiguration failures, deterministic baseline properties, concurrent
apply idempotency where relevant. `tests/unit/
meta-schema-parity.test.ts` pins the transport vocabularies, the
provider-schema/codec contract (including `strict:true` shape), and the
config-resolution table. `tests/unit/request-identity.test.ts` covers
rate-limit identity derivation; the shared fixed-window limiter itself
is covered in `tests/integration/rate-limit.test.ts`.
