import { createServerFn } from "@tanstack/react-start";

import {
  dishDetailParamsSchema,
  dishSearchQuerySchema,
  nameSearchQuerySchema,
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
