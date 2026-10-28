import { createServerFn } from "@tanstack/react-start";

import {
  dishDetailParamsSchema,
  dishSearchQuerySchema,
  nameSearchQuerySchema,
  recommendationQuerySchema,
  relatedQuerySchema,
} from "@/modules/food-discovery/food.schema";
import type { DishSummary } from "@/modules/food-discovery/server/domain/dish";

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

/**
 * Public dish recommendations: deterministic baseline, optionally re-ranked
 * by Muse when MODEL_API_KEY is configured. No authentication needed.
 * The outcome envelope always returns HTTP 200; empty pools and
 * unresolvable allergies are honest outcomes, not errors.
 */
export const recommendDishesFn = createServerFn({ method: "POST" })
  .validator(recommendationQuerySchema)
  .handler(async ({ data }) => {
    const [
      effects,
      { RecommendationService, RecommendationOutcome },
      { Actor },
      { withActor },
      { runApp },
    ] = await loadRecommendServer();

    const noDishes: Array<DishSummary> = [];
    const noNotes: Array<string> = [];

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

    return RecommendationOutcome.$match(outcome, {
      Ready: ({ dishes, mode, warnings }) => ({
        mode,
        dishes: [...dishes],
        warnings: [...warnings],
        reasons: noNotes,
      }),
      Uncertain: ({ reasons }) => ({
        mode: "uncertain" as const,
        dishes: noDishes,
        warnings: noNotes,
        reasons: [...reasons],
      }),
      Empty: ({ reasons }) => ({
        mode: "empty" as const,
        dishes: noDishes,
        warnings: noNotes,
        reasons: [...reasons],
      }),
    });
  });
