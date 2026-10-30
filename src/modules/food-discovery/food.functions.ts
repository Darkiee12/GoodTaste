import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  countryQuerySchema,
  dishBatchQuerySchema,
  dishDetailParamsSchema,
  dishSearchQuerySchema,
  localeSchema,
  nameSearchQuerySchema,
  carouselQuerySchema,
  placeQuerySchema,
  recommendationQuerySchema,
  relatedQuerySchema,
} from "@/modules/food-discovery/food.schema";

const loadServer = () =>
  Promise.all([
    import("effect"),
    import("@/modules/food-discovery/server/operations/dish-service"),
    import("@/modules/food-discovery/server/operations/catalog-service"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
  ]);

const loadRecommendServer = () =>
  Promise.all([
    import("effect"),
    import("@/modules/food-discovery/server/operations/recommendation-service"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
    import("@/server/http/rate-limit"),
    import("@tanstack/react-start/server"),
    import("@/server/http/request"),
    import("@/server/config"),
  ]);

/**
 * Client-safe transport adapters for the FeastJourney globe and dish cards.
 * Validation runs through Zod at this boundary; server-only Effect modules
 * load dynamically so browser bundles never include database code.
 */
export const searchDishesFn = createServerFn({ method: "GET" })
  .validator(dishSearchQuerySchema)
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }] = await loadServer();

    const { runClientOperation } = await import("@/server/http/run-client-operation");

    return runClientOperation(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) =>
          service.searchDishes({
            q: data.q,
            locale: data.locale,
            ingredientIds: data.ingredient,
            ingredientMode: data.ingredient_mode,
            categorySlugs: data.category,
            categoryMode: data.category_mode,
            cuisine: data.cuisine,
            country: data.country,
            region: data.region,
            placeId: data.place,
            association: data.association,
            sort: data.sort,
            limit: data.limit,
            cursor: data.cursor,
          }),
        ),
      ),
      "search",
    );
  });

export const getDishFn = createServerFn({ method: "GET" })
  .validator(dishDetailParamsSchema)
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }] = await loadServer();

    const { runClientOperation } = await import("@/server/http/run-client-operation");

    return runClientOperation(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) => service.getDish(data.id, data.locale)),
      ),
    );
  });

/**
 * Batch card projection for member-owned lists. One server round-trip for up
 * to 50 ids; unpublished or unknown ids are omitted and the caller renders
 * an explicit unavailable row for them.
 */
export const getDishSummariesFn = createServerFn({ method: "GET" })
  .validator(dishBatchQuerySchema)
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) =>
          service.getDishSummaries(data.ids, data.locale),
        ),
      ),
      "fn/dishes/summaries",
      15000,
      "server-fn",
    );
  });

export const getRelatedFn = createServerFn({ method: "GET" })
  .validator(dishDetailParamsSchema.and(relatedQuerySchema))
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) =>
          service.getRelated(data.id, data.locale, data.limit),
        ),
      ),
      "fn/dishes/related",
      15000,
      "server-fn",
    );
  });

export const searchIngredientsFn = createServerFn({ method: "GET" })
  .validator(nameSearchQuerySchema)
  .handler(async ({ data }) => {
    const [effects, _dish, { CatalogService }, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(CatalogService, (service) =>
          service.searchIngredients(data.q, data.locale, data.limit),
        ),
      ),
      "fn/ingredients/search",
      15000,
      "server-fn",
    );
  });

export const listCategoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const [effects, _dish, { CatalogService }, { Actor }, { withActor }, { runApp }] =
    await loadServer();

  return runApp(
    withActor(
      Actor.Guest(),
      effects.Effect.flatMap(CatalogService, (service) => service.listCategories("en")),
    ),
    "fn/categories/list",
    15000,
    "server-fn",
  );
});

/**
 * Public place listing for the recommendation country chooser. Reuses the
 * existing CatalogService/place repository — no new SQL. Guests see ISO
 * codes and display names only; suggestions never claim origin, only
 * association (the region step already words it that way).
 */
export const listPlacesFn = createServerFn({ method: "GET" })
  .validator(placeQuerySchema)
  .handler(async ({ data }) => {
    const [effects, _dish, { CatalogService }, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(CatalogService, (service) =>
          service.listPlaces(data.locale, data.limit),
        ),
      ),
      "fn/places/list",
      15000,
      "server-fn",
    );
  });

/**
 * Country chooser for the recommendation region step. Kind-filtered at the
 * database level with verified ISO identity — every eligible country is
 * reachable regardless of how many other places the catalog holds.
 */
export const listCountriesFn = createServerFn({ method: "GET" })
  .validator(countryQuerySchema)
  .handler(async ({ data }) => {
    const [effects, _dish, { CatalogService }, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(CatalogService, (service) =>
          service.listCountries(data.locale, data.limit),
        ),
      ),
      "fn/countries/list",
      15000,
      "server-fn",
    );
  });

/**
 * Single-round-trip local carousel projection: resolves dishes by visitor
 * coordinate (nearest associated places first) or by country filter, then
 * returns full cards with names, descriptions, ingredients, regions, and
 * image references. No per-card fetch.
 */
export const getLocalCarouselFn = createServerFn({ method: "GET" })
  .validator(carouselQuerySchema)
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) =>
          service.getLocalCarousel({
            country: data.country,
            latitude: data.latitude,
            limit: data.limit,
            locale: data.locale,
            longitude: data.longitude,
            worldwide: data.worldwide,
          }),
        ),
      ),
      "fn/dishes/local-carousel",
      15000,
      "server-fn",
    );
  });

/**
 * Coarse visitor region for the local-discovery carousel: Cloudflare
 * `cf-*` headers when deployed behind the CDN, nulls locally. The country
 * code filters the public catalog; nothing here identifies a person.
 */
export const getVisitorRegionFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getVisitorRegionFromHeaders } = await import("@/server/geo/visitor-region");
  const server = await import("@tanstack/react-start/server");

  return getVisitorRegionFromHeaders(server.getRequestHeaders());
});

export const listCuisinesFn = createServerFn({ method: "GET" })
  .validator(z.object({ locale: localeSchema.optional() }))
  .handler(async ({ data }) => {
    const [effects, _dish, { CatalogService }, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(CatalogService, (service) =>
          service.listCuisines(data.locale ?? "en"),
        ),
      ),
      "fn/cuisines/list",
      15000,
      "server-fn",
    );
  });

/**
 * Public dish recommendations: deterministic baseline, optionally re-ranked
 * by Muse when RECOMMENDATION_PROVIDER is "muse" with valid credentials. No
 * authentication needed. The outcome envelope always returns HTTP 200; empty
 * pools and allergy refusals are honest outcomes, not errors. Auth, permanent
 * provider, and misconfiguration failures reject and surface as HTTP 500.
 */
export const recommendDishesFn = createServerFn({ method: "POST" })
  .validator(recommendationQuerySchema)
  .handler(async ({ data }) => {
    const [
      effects,
      { RecommendationService, toWireOutcome },
      { Actor },
      { withActor },
      { runApp },
      { RateLimitPolicy },
      server,
      { resolveIdentityFromHeaders },
      { appConfig },
    ] = await loadRecommendServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    // Enforce the public recommendation budget BEFORE any database or model
    // work. Thrown Responses bypass TanStack's header filtering, so the
    // 429 status and Retry-After survive to the client (verified against
    // the installed start-server-core handler).
    await runApp(
      effects.Effect.flatMap(RateLimitPolicy, (policy) =>
        effects.Effect.flatMap(appConfig, (config) =>
          policy.check("search", resolveIdentityFromHeaders(headers, config)).pipe(
            effects.Effect.catchTag("RateLimitExceeded", (failure) =>
              effects.Effect.die(
                new Response(
                  JSON.stringify({
                    error: "rate_limited",
                    retryAfterSeconds: failure.retryAfterSeconds,
                  }),
                  {
                    status: 429,
                    headers: {
                      "content-type": "application/json",
                      "Retry-After": String(failure.retryAfterSeconds),
                    },
                  },
                ),
              ),
            ),
            effects.Effect.catchTag("StoreUnavailable", () =>
              effects.Effect.die(
                new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
                  status: 503,
                  headers: { "content-type": "application/json" },
                }),
              ),
            ),
          ),
        ),
      ),
      "fn/dishes/recommend-rate-limit",
      5000,
      requestId,
    );

    const outcome = await runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(RecommendationService, (service) =>
          service.recommend({
            meal: data.meal,
            avoid: data.avoid,
            allergies: data.allergies,
            cuisine: data.cuisine,
            country: data.country,
            mood: data.mood,
            locale: data.locale,
            surpriseSeed: data.surpriseSeed,
          }),
        ),
      ),
      "fn/dishes/recommend",
      30000,
      "server-fn",
    );

    return toWireOutcome(outcome);
  });
