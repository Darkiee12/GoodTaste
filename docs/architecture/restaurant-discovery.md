# Restaurant discovery and observed prices

PR #4 owns `src/modules/restaurant-discovery/`, its additive Flyway migration
`V20261028_100`–`106`, and restaurant routes/tests. Shared changes are limited to
runtime composition, the permission vocabulary, User currency preference,
home navigation, and the documented public contracts. Food Discovery's
canonical identity and private queries remain read-only dependencies.

The outcome is two public journeys: dish → sourced restaurant offering, and
restaurant → menu → canonical dish. No questionnaire or AI is required.

## Persistence and trust

A business has physical venues. Menus, sources, items, variants, serving
evidence and prices are scoped to a venue. Composite foreign keys reject
cross-branch evidence and prices. An item has an explicit `As listed`
variant if no meaningful variant exists. A nullable, editorially assigned
comparison key groups comparable portions; unknown portions cannot qualify
for price sorting or a budget filter. Cuisine is never serving evidence.

Only accepted, unexpired exact/variant evidence participates in dish search.
Suggested/fuzzy matches remain outside verified discovery. The published
Food Discovery API confirms dish publication before search. Every privileged
operation checks current database RBAC inside the operation and records an
audit event in the mutation transaction.

Item/variant identities cannot be relabelled after creation; retirement changes visibility without erasing history. Moving a branch invalidates its earlier source snapshots.

Prices are append-only NUMERIC observations, with source, variant, channel,
listed/paid kind, tax treatment and review horizon. A reviewed listed price
always precedes a receipt-paid price. Current restaurant-verified official
listed prices take precedence over other reviewed listed prices; ties use
observation time and ID. Historical observations and conflicts remain in the
review surface. The horizon is editorial policy, never a guarantee of current
availability. Stale prices are labelled and excluded from strict comparisons.

Receipts retain only structured food-line amounts and semantics, never card,
customer or transaction identifiers. A derived paid unit amount must multiply exactly by quantity to reproduce the
known net food-line total. Explicit unit prices must match the observed amount.
Discount/fee breakdowns may be NULL when unknown; they never default to zero.
Public receipt/photo submission and extraction are deferred; admin entry
supports their reviewed observation contract without OCR infrastructure.

## Currency contract

Original currency is always primary. A conversion is optional and approximate,
with effective date and source. A display-only FX failure leaves original
prices intact. A budget/sort FX failure fails explicitly; unknown prices never
qualify as zero. SQL compares unrounded NUMERIC products against exact budget
strings using one request's rate snapshot. Portion and sales channel must match.

The router preserves scalar URL values as text before Zod validation. Its default
JSON/number coercion is deliberately replaced: direct dish IDs beyond Number's
safe range and decimal budgets must not lose precision before reaching SQL.
Repeated scalar keys are rejected by validators; older quoted-string links work.

Frankfurter v2 supplies daily reference rates. CSV preserves the decimal token
without JSON number parsing. Provider currency metadata is intersected with
SIX’s authoritative ISO 4217 monetary currency vocabulary, excluding crypto/provider pseudo-codes.
Effect v4 already provides BigDecimal; conversion uses that existing exact
decimal implementation. Display rounds half away from zero to ISO currency
fraction digits. Intl formats integer BigInts and localized fractional digits,
so even large amounts never pass through JavaScript Number.

The PostgreSQL cache retains provider/date/pair history. Refresh defaults to
24 hours; effective-date age defaults to 72 hours (measured from the end of
the provider date to allow normal weekends). Expiring token leases bound
cross-process refreshes without holding a database transaction across HTTP.
Failed refreshes have a short cooldown. Cached rates past the maximum age are
never used. Provider HTTP has timeout, size and pair/date validation.

Account currency overrides local explicit preference; local preference serves
guests and accounts without a saved currency. No geographic inference is
persisted. Currency-only display changes fetch rates, not restaurant rows.

## Design and verification

The existing cream, navy, orange, expressive heading and compact editorial
cards are the visual references. Search uses labelled native controls, a list
alternative to the optional map, explicit Near Me consent, empty/error/retry
states and a mobile list/map toggle. The map is lazily mounted in ClientOnly.

Verification covers fresh Flyway migration/validation, actual PostgreSQL/PostGIS
queries and constraints, mocked FX failure/concurrency/decimal tests, production
SSR/build and browser checks. Synthetic fixtures never become product data.
Global geographic price analytics, public crowdsourcing, OCR, POS integration
and live availability are outside this slice.

## Operating the MVP

Authorized curators use `/admin/restaurants` to create a business/venue, enter a
source-backed menu import, and submit observations. Imports remain pending until
an actor with `restaurant:review` approves the price and serving evidence.
Re-importing an existing offering must preserve its identity; append a new dated
observation for price changes. Archive offerings to retire them. Source keys
prevent duplicated submissions. Photo/file references are metadata only; this
slice does not implement uploading, OCR or public receipt collection.

Optional settings are listed in `.env.example`: `FX_ENDPOINT`,
`FX_REFRESH_HOURS` (24), `FX_MAX_AGE_HOURS` (72),
`RESTAURANT_REVIEW_DAYS` (90), and the browser-visible licensed
`VITE_MAP_STYLE_URL`. Without a style URL, the restaurant list remains usable.
The [Frankfurter documentation](https://frankfurter.dev/) describes its public,
keyless daily-reference API and encourages caching; provider availability and
abuse limits still apply. Currency vocabulary comes from
[SIX ISO 4217 maintenance](https://www.six-group.com/en/products-services/financial-information/data-standards.html).

No restaurant inventory ships with this change. Administrators must supply
verifiable sources before results appear. New discovery labels are currently
English. Hosted map tiles and provider billing/restrictions must be configured
for the deployment; browser verification used an intercepted empty test style.
Live Frankfurter access was checked separately; ordinary tests use mocked FX.
Public crowdsourcing, binary-source verification, OCR/POS integrations, global
origin-country price comparisons and live availability remain deferred.
