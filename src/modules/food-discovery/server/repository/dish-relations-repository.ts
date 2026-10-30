import { Context, Effect, Layer } from "effect";

import dishCategoriesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-categories-by-dish-ids.sql";
import dishCategoryLink from "@/modules/food-discovery/server/repository/sql/dish-category-link.sql";
import dishCuisineLink from "@/modules/food-discovery/server/repository/sql/dish-cuisine-link.sql";
import dishCuisinesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-cuisines-by-dish-ids.sql";
import dishDescriptionUpsert from "@/modules/food-discovery/server/repository/sql/dish-description-upsert.sql";
import dishDescriptionsByDishIds from "@/modules/food-discovery/server/repository/sql/dish-descriptions-by-dish-ids.sql";
import dishFilter from "@/modules/food-discovery/server/repository/sql/dish-filter.sql";
import dishIngredientLink from "@/modules/food-discovery/server/repository/sql/dish-ingredient-link.sql";
import dishIngredientsByDishIds from "@/modules/food-discovery/server/repository/sql/dish-ingredients-by-dish-ids.sql";
import dishMediaByDishIds from "@/modules/food-discovery/server/repository/sql/dish-media-by-dish-ids.sql";
import dishMediaPublishedByDishIds from "@/modules/food-discovery/server/repository/sql/dish-media-published-by-dish-ids.sql";
import dishNameInsert from "@/modules/food-discovery/server/repository/sql/dish-name-insert.sql";
import dishNamesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-names-by-dish-ids.sql";
import dishPlaceLink from "@/modules/food-discovery/server/repository/sql/dish-place-link.sql";
import dishPlacesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-places-by-dish-ids.sql";
import dishSourceLink from "@/modules/food-discovery/server/repository/sql/dish-source-link.sql";
import dishSourcesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-sources-by-dish-ids.sql";
import ingredientNameInsert from "@/modules/food-discovery/server/repository/sql/ingredient-name-insert.sql";
import type { Database, DbClient } from "@/server/database/client";
import { PersistenceConflict, classifyDatabaseError } from "@/server/database/errors";
import { type DatabaseError, runQuery } from "@/server/database/query";

export type DishNameRow = (typeof dishNamesByDishIds)["~reylo"]["element"];

export type DishDescriptionRow = (typeof dishDescriptionsByDishIds)["~reylo"]["element"];

export type DishIngredientRow = (typeof dishIngredientsByDishIds)["~reylo"]["element"];

export type DishMediaRow = (typeof dishMediaByDishIds)["~reylo"]["element"];

export type DishPublishedMediaRow = (typeof dishMediaPublishedByDishIds)["~reylo"]["element"];

export type DishPlaceRow = (typeof dishPlacesByDishIds)["~reylo"]["element"];

export type DishCategoryRow = (typeof dishCategoriesByDishIds)["~reylo"]["element"];

export type DishCuisineRow = (typeof dishCuisinesByDishIds)["~reylo"]["element"];

export type DishSourceRow = (typeof dishSourcesByDishIds)["~reylo"]["element"];

export class DishRelationsRepository extends Context.Service<
  DishRelationsRepository,
  {
    readonly namesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishNameRow>, DatabaseError, Database>;
    readonly descriptionsByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishDescriptionRow>, DatabaseError, Database>;
    readonly ingredientsByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishIngredientRow>, DatabaseError, Database>;
    /**
     * Legacy status-filtered read. No public surface uses this anymore —
     * prefer publishedMediaByDishIds for catalog projections.
     * @deprecated Use publishedMediaByDishIds for public surfaces.
     */
    readonly mediaByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishMediaRow>, DatabaseError, Database>;
    /**
     * Public catalog projection: published + ready rows only, ordered by
     * sort_order (primary first). Backed by
     * dish-media-published-by-dish-ids.sql — the same source as
     * DishMediaService.publishedImagesByDishIds. Prefer this over
     * mediaByDishIds for any public surface.
     */
    readonly publishedMediaByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishPublishedMediaRow>, DatabaseError, Database>;
    readonly placesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishPlaceRow>, DatabaseError, Database>;
    readonly categoriesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishCategoryRow>, DatabaseError, Database>;
    readonly cuisinesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishCuisineRow>, DatabaseError, Database>;
    readonly sourcesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishSourceRow>, DatabaseError, Database>;
    readonly filterIds: (input: {
      readonly ingredientIds: ReadonlyArray<bigint>;
      readonly categoryIds: ReadonlyArray<bigint>;
      readonly placeIds: ReadonlyArray<bigint>;
      readonly ingredientMode: string;
      readonly categoryMode: string;
      readonly cuisine: string | null;
      readonly association: string | null;
      readonly status: string;
      readonly cursor: bigint;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseError, Database>;
    readonly insertName: (input: {
      readonly dishId: bigint;
      readonly languageTag: string;
      readonly name: string;
      readonly nameKind: string;
      readonly isPreferred: boolean;
      readonly searchKey: string;
    }) => Effect.Effect<DishNameRow, DatabaseError, Database>;
    readonly upsertDescription: (input: {
      readonly dishId: bigint;
      readonly languageTag: string;
      readonly description: string;
      readonly summary: string | null;
    }) => Effect.Effect<DishDescriptionRow, DatabaseError, Database>;
    readonly linkDishSource: (
      dishId: bigint,
      sourceRecordId: bigint,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly linkIngredient: (
      dishId: bigint,
      ingredientId: bigint,
      role: string,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly linkPlace: (input: {
      readonly dishId: bigint;
      readonly placeId: bigint;
      readonly association: string;
      readonly isDisputed: boolean;
      readonly note: string | null;
    }) => Effect.Effect<void, DatabaseError, Database>;
    readonly linkCategory: (
      dishId: bigint,
      categoryId: bigint,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly linkCuisine: (
      dishId: bigint,
      cuisineId: bigint,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly insertIngredientName: (input: {
      readonly ingredientId: bigint;
      readonly languageTag: string;
      readonly name: string;
      readonly nameKind: string;
      readonly isPreferred: boolean;
      readonly searchKey: string;
    }) => Effect.Effect<void, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/DishRelationsRepository") {}

const runVoid = <A>(
  operation: string,
  task: (sql: DbClient) => Promise<A>,
): Effect.Effect<void, DatabaseError, Database> => Effect.asVoid(runQuery(operation, task));

export const DishRelationsRepositoryLive = Layer.succeed(DishRelationsRepository, {
  namesByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/names-by-ids", (sql) =>
        dishNamesByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  descriptionsByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/descriptions-by-ids", (sql) =>
        dishDescriptionsByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  ingredientsByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/ingredients-by-ids", (sql) =>
        dishIngredientsByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  mediaByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/media-by-ids", (sql) =>
        dishMediaByDishIds.run(sql, { ids: [...ids], status: "published" }),
      );
    }),
  publishedMediaByDishIds: (ids) =>
    Effect.gen(function* () {
      if (ids.length === 0) {
        return [];
      }

      return yield* runQuery("dish/media-published-by-ids", (sql) =>
        dishMediaPublishedByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  placesByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/places-by-ids", (sql) =>
        dishPlacesByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  categoriesByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/categories-by-ids", (sql) =>
        dishCategoriesByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  cuisinesByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/cuisines-by-ids", (sql) =>
        dishCuisinesByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  sourcesByDishIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/sources-by-ids", (sql) =>
        dishSourcesByDishIds.run(sql, { ids: [...ids] }),
      );
    }),
  filterIds: (input) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/filter", (sql) =>
        dishFilter.run(sql, {
          ingredient_ids: [...input.ingredientIds],
          category_ids: [...input.categoryIds],
          place_ids: [...input.placeIds],
          ingredient_mode: input.ingredientMode,
          category_mode: input.categoryMode,
          cuisine: input.cuisine,
          association: input.association,
          status: input.status,
          cursor: input.cursor,
          limit: input.limit,
        }),
      );

      return rows.map((row) => row.id);
    }),
  insertName: (input) =>
    Effect.gen(function* () {
      const outcome = yield* runQuery("dish/name-insert", (sql) =>
        dishNameInsert.try(sql, {
          dish_id: input.dishId,
          language_tag: input.languageTag,
          name: input.name,
          name_kind: input.nameKind,
          is_preferred: input.isPreferred,
          search_key: input.searchKey,
        }),
      );

      if (outcome.error !== undefined) {
        if (outcome.error.condition === "unique_violation") {
          return yield* new PersistenceConflict({
            operation: "dish/name-insert",
            constraint: outcome.error.constraint ?? undefined,
          });
        }

        return yield* classifyDatabaseError("dish/name-insert", outcome.error.cause);
      }

      return outcome.value;
    }),
  upsertDescription: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/description-upsert", (sql) =>
        dishDescriptionUpsert.run(sql, {
          dish_id: input.dishId,
          language_tag: input.languageTag,
          description: input.description,
          summary: input.summary,
        }),
      );
    }),
  linkDishSource: (dishId, sourceRecordId) =>
    runVoid("dish/source-link", (sql) =>
      dishSourceLink.run(sql, { dish_id: dishId, source_record_id: sourceRecordId }),
    ),
  linkIngredient: (dishId, ingredientId, role) =>
    runVoid("dish/ingredient-link", (sql) =>
      dishIngredientLink.run(sql, {
        dish_id: dishId,
        ingredient_id: ingredientId,
        role,
      }),
    ),
  linkPlace: (input) =>
    runVoid("dish/place-link", (sql) =>
      dishPlaceLink.run(sql, {
        dish_id: input.dishId,
        place_id: input.placeId,
        association: input.association,
        is_disputed: input.isDisputed,
        note: input.note,
      }),
    ),
  linkCategory: (dishId, categoryId) =>
    runVoid("dish/category-link", (sql) =>
      dishCategoryLink.run(sql, { dish_id: dishId, category_id: categoryId }),
    ),
  linkCuisine: (dishId, cuisineId) =>
    runVoid("dish/cuisine-link", (sql) =>
      dishCuisineLink.run(sql, { dish_id: dishId, cuisine_id: cuisineId }),
    ),
  insertIngredientName: (input) =>
    runVoid("ingredient/name-insert", (sql) =>
      ingredientNameInsert.run(sql, {
        ingredient_id: input.ingredientId,
        language_tag: input.languageTag,
        name: input.name,
        name_kind: input.nameKind,
        is_preferred: input.isPreferred,
        search_key: input.searchKey,
      }),
    ),
});
