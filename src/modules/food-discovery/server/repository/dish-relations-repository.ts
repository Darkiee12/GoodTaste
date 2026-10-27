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
import dishNameInsert from "@/modules/food-discovery/server/repository/sql/dish-name-insert.sql";
import dishNamesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-names-by-dish-ids.sql";
import dishPlaceLink from "@/modules/food-discovery/server/repository/sql/dish-place-link.sql";
import dishPlacesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-places-by-dish-ids.sql";
import dishSourceLink from "@/modules/food-discovery/server/repository/sql/dish-source-link.sql";
import dishSourcesByDishIds from "@/modules/food-discovery/server/repository/sql/dish-sources-by-dish-ids.sql";
import ingredientNameInsert from "@/modules/food-discovery/server/repository/sql/ingredient-name-insert.sql";
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database, DbClient } from "@/server/database/client";
import {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
} from "@/server/database/errors";

export type DishNameRow = (typeof dishNamesByDishIds)["~reylo"]["element"];

export type DishDescriptionRow = (typeof dishDescriptionsByDishIds)["~reylo"]["element"];

export type DishIngredientRow = (typeof dishIngredientsByDishIds)["~reylo"]["element"];

export type DishPlaceRow = (typeof dishPlacesByDishIds)["~reylo"]["element"];

export type DishCategoryRow = (typeof dishCategoriesByDishIds)["~reylo"]["element"];

export type DishCuisineRow = (typeof dishCuisinesByDishIds)["~reylo"]["element"];

export type DishSourceRow = (typeof dishSourcesByDishIds)["~reylo"]["element"];

const isReadonlyArray = <Row>(value: Row | ReadonlyArray<Row>): value is ReadonlyArray<Row> =>
  Array.isArray(value);

const toArray = <Row>(value: Row | ReadonlyArray<Row>): Array<Row> =>
  isReadonlyArray(value) ? [...value] : [value];

const readFailure = (operation: string, cause: unknown): DatabaseUnavailable | PersistenceError =>
  isConnectionFailure(cause)
    ? new DatabaseUnavailable({ operation })
    : new PersistenceError({
        operation,
        cause: cause instanceof Error ? cause.message : String(cause),
      });

export class DishRelationsRepository extends Context.Service<
  DishRelationsRepository,
  {
    readonly namesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishNameRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly descriptionsByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishDescriptionRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly ingredientsByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishIngredientRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly placesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishPlaceRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly categoriesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishCategoryRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly cuisinesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishCuisineRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly sourcesByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<DishSourceRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
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
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly insertName: (input: {
      readonly dishId: bigint;
      readonly languageTag: string;
      readonly name: string;
      readonly nameKind: string;
      readonly isPreferred: boolean;
      readonly searchKey: string;
    }) => Effect.Effect<
      DishNameRow,
      DatabaseUnavailable | PersistenceError | PersistenceConflict,
      Database
    >;
    readonly upsertDescription: (input: {
      readonly dishId: bigint;
      readonly languageTag: string;
      readonly description: string;
      readonly summary: string | null;
    }) => Effect.Effect<DishDescriptionRow, DatabaseUnavailable | PersistenceError, Database>;
    readonly linkDishSource: (
      dishId: bigint,
      sourceRecordId: bigint,
    ) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
    readonly linkIngredient: (
      dishId: bigint,
      ingredientId: bigint,
      role: string,
    ) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
    readonly linkPlace: (input: {
      readonly dishId: bigint;
      readonly placeId: bigint;
      readonly association: string;
      readonly isDisputed: boolean;
      readonly note: string | null;
    }) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
    readonly linkCategory: (
      dishId: bigint,
      categoryId: bigint,
    ) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
    readonly linkCuisine: (
      dishId: bigint,
      cuisineId: bigint,
    ) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
    readonly insertIngredientName: (input: {
      readonly ingredientId: bigint;
      readonly languageTag: string;
      readonly name: string;
      readonly nameKind: string;
      readonly isPreferred: boolean;
      readonly searchKey: string;
    }) => Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database>;
  }
>()("feastjourney/food-discovery/DishRelationsRepository") {}

const runVoid = (
  operation: string,
  task: (sql: DbClient) => Promise<void>,
): Effect.Effect<void, DatabaseUnavailable | PersistenceError, Database> =>
  Effect.gen(function* () {
    const sql = yield* currentSql;
    yield* Effect.tryPromise({
      try: () => task(sql),
      catch: (cause) => readFailure(operation, cause),
    });
  });

export const DishRelationsRepositoryLive = Layer.succeed(DishRelationsRepository, {
  namesByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishNamesByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/names-by-ids", cause),
      });

      return toArray(rows);
    }),
  descriptionsByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishDescriptionsByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/descriptions-by-ids", cause),
      });

      return toArray(rows);
    }),
  ingredientsByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishIngredientsByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/ingredients-by-ids", cause),
      });

      return toArray(rows);
    }),
  placesByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishPlacesByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/places-by-ids", cause),
      });

      return toArray(rows);
    }),
  categoriesByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishCategoriesByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/categories-by-ids", cause),
      });

      return toArray(rows);
    }),
  cuisinesByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishCuisinesByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/cuisines-by-ids", cause),
      });

      return toArray(rows);
    }),
  sourcesByDishIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishSourcesByDishIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/sources-by-ids", cause),
      });

      return toArray(rows);
    }),
  filterIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
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
        catch: (cause) => readFailure("dish/filter", cause),
      });

      return toArray(rows).map((row) => row.id);
    }),
  insertName: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const outcome = yield* Effect.tryPromise({
        try: () =>
          dishNameInsert.try(sql, {
            dish_id: input.dishId,
            language_tag: input.languageTag,
            name: input.name,
            name_kind: input.nameKind,
            is_preferred: input.isPreferred,
            search_key: input.searchKey,
          }),
        catch: (cause) => readFailure("dish/name-insert", cause),
      });

      if (outcome.error !== undefined) {
        if (outcome.error.condition === "unique_violation") {
          return yield* new PersistenceConflict({
            operation: "dish/name-insert",
            constraint: outcome.error.constraint ?? undefined,
          });
        }

        return yield* readFailure("dish/name-insert", outcome.error.cause);
      }

      const created = toArray(outcome.value);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "dish/name-insert",
          cause: "insert returned no row",
        });
      }

      return first;
    }),
  upsertDescription: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          dishDescriptionUpsert.run(sql, {
            dish_id: input.dishId,
            language_tag: input.languageTag,
            description: input.description,
            summary: input.summary,
          }),
        catch: (cause) => readFailure("dish/description-upsert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "dish/description-upsert",
          cause: "upsert returned no row",
        });
      }

      return first;
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
    Effect.gen(function* () {
      const sql = yield* currentSql;
      yield* Effect.tryPromise({
        try: () =>
          ingredientNameInsert.run(sql, {
            ingredient_id: input.ingredientId,
            language_tag: input.languageTag,
            name: input.name,
            name_kind: input.nameKind,
            is_preferred: input.isPreferred,
            search_key: input.searchKey,
          }),
        catch: (cause) => readFailure("ingredient/name-insert", cause),
      });
    }),
});
