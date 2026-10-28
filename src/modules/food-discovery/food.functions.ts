import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  dishDetailParamsSchema,
  dishSearchQuerySchema,
  localeSchema,
  nameSearchQuerySchema,
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
    const [effects, { DishService }, _catalog, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
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
      "fn/dishes/search",
      15000,
      "server-fn",
    );
  });

export const getDishFn = createServerFn({ method: "GET" })
  .validator(dishDetailParamsSchema)
  .handler(async ({ data }) => {
    const [effects, { DishService }, _catalog, { Actor }, { withActor }, { runApp }] =
      await loadServer();

    return runApp(
      withActor(
        Actor.Guest(),
        effects.Effect.flatMap(DishService, (service) => service.getDish(data.id, data.locale)),
      ),
      "fn/dishes/detail",
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
          }),
        ),
      ),
      "fn/dishes/recommend",
      30000,
      "server-fn",
    );

    return toWireOutcome(outcome);
  });
