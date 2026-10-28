import { Context, Effect, Layer } from "effect";

import ingredientFindById from "@/modules/food-discovery/server/repository/sql/ingredient-find-by-id.sql";
import ingredientInsert from "@/modules/food-discovery/server/repository/sql/ingredient-insert.sql";
import ingredientNameResolve from "@/modules/food-discovery/server/repository/sql/ingredient-name-resolve.sql";
import ingredientNamesByIngredientIds from "@/modules/food-discovery/server/repository/sql/ingredient-names-by-ingredient-ids.sql";
import ingredientSearch from "@/modules/food-discovery/server/repository/sql/ingredient-search.sql";
import type { Database } from "@/server/database/client";
import { PersistenceConflict, classifyDatabaseError } from "@/server/database/errors";
import { type DatabaseError, runQuery } from "@/server/database/query";

export type IngredientRow = (typeof ingredientFindById)["~reylo"]["element"];

export type IngredientNameRow = (typeof ingredientNamesByIngredientIds)["~reylo"]["element"];

export interface IngredientRecord {
  readonly id: bigint;
}

export class IngredientRepository extends Context.Service<
  IngredientRepository,
  {
    readonly searchIds: (input: {
      readonly q: string;
      readonly prefix: string;
      readonly contains: string;
      readonly limit: number;
    }) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly tier: number }>,
      DatabaseError,
      Database
    >;
    readonly findById: (
      id: bigint,
    ) => Effect.Effect<IngredientRecord | null, DatabaseError, Database>;
    readonly namesByIngredientIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<IngredientNameRow>, DatabaseError, Database>;
    readonly resolveByKey: (
      key: string,
      languageTag: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly ingredientId: bigint; readonly name: string }>,
      DatabaseError,
      Database
    >;
    readonly insert: () => Effect.Effect<IngredientRecord, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/IngredientRepository") {}

export const IngredientRepositoryLive = Layer.succeed(IngredientRepository, {
  searchIds: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("ingredient/search", (sql) =>
        ingredientSearch.run(sql, {
          q: input.q,
          prefix: input.prefix,
          contains: input.contains,
          limit: input.limit,
        }),
      );
    }),
  findById: (id) =>
    Effect.gen(function* () {
      const row = yield* runQuery("ingredient/find-by-id", (sql) =>
        ingredientFindById.run(sql, { id }),
      );

      if (row === null) {
        return null;
      }

      return { id: row.id };
    }),
  namesByIngredientIds: (ids) =>
    Effect.gen(function* () {
      return yield* runQuery("ingredient/names-by-ids", (sql) =>
        ingredientNamesByIngredientIds.run(sql, { ids: [...ids] }),
      );
    }),
  resolveByKey: (key, languageTag, limit) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("ingredient/name-resolve", (sql) =>
        ingredientNameResolve.run(sql, {
          key,
          language_tag: languageTag,
          limit,
        }),
      );

      return rows.map((row) => ({
        ingredientId: row.ingredient_id,
        name: row.name,
      }));
    }),
  insert: () =>
    Effect.gen(function* () {
      const outcome = yield* runQuery("ingredient/insert", (sql) => ingredientInsert.try(sql));

      if (outcome.error !== undefined) {
        if (outcome.error.condition === "unique_violation") {
          return yield* new PersistenceConflict({
            operation: "ingredient/insert",
            constraint: outcome.error.constraint ?? undefined,
          });
        }

        return yield* classifyDatabaseError("ingredient/insert", outcome.error.cause);
      }

      return { id: outcome.value.id };
    }),
});
