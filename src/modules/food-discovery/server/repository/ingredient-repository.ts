import { Context, Effect, Layer } from "effect";

import ingredientFindById from "@/modules/food-discovery/server/repository/sql/ingredient-find-by-id.sql";
import ingredientInsert from "@/modules/food-discovery/server/repository/sql/ingredient-insert.sql";
import ingredientNameResolve from "@/modules/food-discovery/server/repository/sql/ingredient-name-resolve.sql";
import ingredientNamesByIngredientIds from "@/modules/food-discovery/server/repository/sql/ingredient-names-by-ingredient-ids.sql";
import ingredientSearch from "@/modules/food-discovery/server/repository/sql/ingredient-search.sql";
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
} from "@/server/database/errors";

export type IngredientRow = (typeof ingredientFindById)["~reylo"]["element"];

export type IngredientNameRow = (typeof ingredientNamesByIngredientIds)["~reylo"]["element"];

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
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly findById: (
      id: bigint,
    ) => Effect.Effect<IngredientRecord | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly namesByIngredientIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<IngredientNameRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly resolveByKey: (
      key: string,
      languageTag: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly ingredientId: bigint; readonly name: string }>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly insert: () => Effect.Effect<
      IngredientRecord,
      DatabaseUnavailable | PersistenceError | PersistenceConflict,
      Database
    >;
  }
>()("feastjourney/food-discovery/IngredientRepository") {}

export const IngredientRepositoryLive = Layer.succeed(IngredientRepository, {
  searchIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          ingredientSearch.run(sql, {
            q: input.q,
            prefix: input.prefix,
            contains: input.contains,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("ingredient/search", cause),
      });

      return toArray(rows);
    }),
  findById: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => ingredientFindById.run(sql, { id }),
        catch: (cause) => readFailure("ingredient/find-by-id", cause),
      });

      if (row === null) {
        return null;
      }

      return { id: row.id };
    }),
  namesByIngredientIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => ingredientNamesByIngredientIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("ingredient/names-by-ids", cause),
      });

      return toArray(rows);
    }),
  resolveByKey: (key, languageTag, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          ingredientNameResolve.run(sql, {
            key,
            language_tag: languageTag,
            limit,
          }),
        catch: (cause) => readFailure("ingredient/name-resolve", cause),
      });

      return toArray(rows).map((row) => ({
        ingredientId: row.ingredient_id,
        name: row.name,
      }));
    }),
  insert: () =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const outcome = yield* Effect.tryPromise({
        try: () => ingredientInsert.try(sql),
        catch: (cause) => readFailure("ingredient/insert", cause),
      });

      if (outcome.error !== undefined) {
        if (outcome.error.condition === "unique_violation") {
          return yield* new PersistenceConflict({
            operation: "ingredient/insert",
            constraint: outcome.error.constraint ?? undefined,
          });
        }

        return yield* readFailure("ingredient/insert", outcome.error.cause);
      }

      const created = toArray(outcome.value);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "ingredient/insert",
          cause: "insert returned no row",
        });
      }

      return { id: first.id };
    }),
});
