import { Context, Effect, Layer } from "effect";

import type { DishStatus } from "@/modules/food-discovery/server/domain/ids";
import adminDishesByStatus from "@/modules/food-discovery/server/repository/sql/admin-dishes-by-status.sql";
import adminDishesMissingIngredientsCount from "@/modules/food-discovery/server/repository/sql/admin-dishes-missing-ingredients-count.sql";
import adminDishesRecent from "@/modules/food-discovery/server/repository/sql/admin-dishes-recent.sql";
import dishBrowse from "@/modules/food-discovery/server/repository/sql/dish-browse.sql";
import dishCountByStatus from "@/modules/food-discovery/server/repository/sql/dish-count-by-status.sql";
import dishFindById from "@/modules/food-discovery/server/repository/sql/dish-find-by-id.sql";
import dishFindByIds from "@/modules/food-discovery/server/repository/sql/dish-find-by-ids.sql";
import dishFindBySlug from "@/modules/food-discovery/server/repository/sql/dish-find-by-slug.sql";
import dishInsert from "@/modules/food-discovery/server/repository/sql/dish-insert.sql";
import dishListByStatus from "@/modules/food-discovery/server/repository/sql/dish-list-by-status.sql";
import dishNameResolve from "@/modules/food-discovery/server/repository/sql/dish-name-resolve.sql";
import dishRecordsByIds from "@/modules/food-discovery/server/repository/sql/dish-records-by-ids.sql";
import dishRelated from "@/modules/food-discovery/server/repository/sql/dish-related.sql";
import dishSearchRecent from "@/modules/food-discovery/server/repository/sql/dish-search-recent.sql";
import dishSearch from "@/modules/food-discovery/server/repository/sql/dish-search.sql";
import dishUpdateStatus from "@/modules/food-discovery/server/repository/sql/dish-update-status.sql";
import dishUpdate from "@/modules/food-discovery/server/repository/sql/dish-update.sql";
import type { Database } from "@/server/database/client";
import {
  PersistenceConflict,
  PersistenceError,
  classifyDatabaseError,
} from "@/server/database/errors";
import { type DatabaseError, runQuery } from "@/server/database/query";

export type DishRecord = (typeof dishFindById)["~reylo"]["element"];

export type AdminDishRow = (typeof adminDishesByStatus)["~reylo"]["element"];

export type AdminDishRecentRow = (typeof adminDishesRecent)["~reylo"]["element"];

export class DishRepository extends Context.Service<
  DishRepository,
  {
    readonly findById: (id: bigint) => Effect.Effect<DishRecord | null, DatabaseError, Database>;
    readonly findBySlug: (
      slug: string,
    ) => Effect.Effect<DishRecord | null, DatabaseError, Database>;
    readonly findByIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<bigint>, DatabaseError, Database>;
    readonly recordsByIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishRecord>, DatabaseError, Database>;
    readonly listByStatus: (
      status: DishStatus,
      cursor: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<DishRecord>, DatabaseError, Database>;
    readonly countByStatus: (status: DishStatus) => Effect.Effect<number, DatabaseError, Database>;
    readonly missingIngredientsCount: () => Effect.Effect<number, DatabaseError, Database>;
    readonly recentAdminDishes: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminDishRecentRow>, DatabaseError, Database>;
    readonly listAdminDishes: (
      status: string,
      cursor: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminDishRow>, DatabaseError, Database>;
    readonly searchIds: (input: {
      readonly q: string;
      readonly prefix: string;
      readonly contains: string;
      readonly status: string;
      readonly tier: number;
      readonly cursor: bigint;
      readonly limit: number;
    }) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly tier: number }>,
      DatabaseError,
      Database
    >;
    readonly searchRecentIds: (input: {
      readonly q: string;
      readonly prefix: string;
      readonly contains: string;
      readonly status: string;
      readonly updated: string;
      readonly cursor: bigint;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseError, Database>;
    readonly browseIds: (input: {
      readonly status: string;
      readonly updated: string;
      readonly cursor: bigint;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseError, Database>;
    readonly resolveByNameKey: (
      key: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<bigint>, DatabaseError, Database>;
    readonly relatedIds: (
      id: bigint,
      status: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly shared: number }>,
      DatabaseError,
      Database
    >;
    readonly insert: (input: {
      readonly slug: string;
      readonly parentDishId: bigint | null;
      readonly status: string;
    }) => Effect.Effect<DishRecord, DatabaseError, Database>;
    readonly update: (input: {
      readonly id: bigint;
      readonly slug: string;
      readonly parentDishId: bigint | null;
      readonly status: string;
    }) => Effect.Effect<DishRecord | null, DatabaseError, Database>;
    readonly updateStatus: (
      id: bigint,
      status: string,
    ) => Effect.Effect<DishRecord | null, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/DishRepository") {}

const insertConflict = (
  operation: string,
  outcome: {
    readonly error?: {
      readonly condition?: string;
      readonly constraint?: string;
      readonly cause: unknown;
    };
  },
): Effect.Effect<never, DatabaseError> =>
  Effect.gen(function* () {
    if (outcome.error !== undefined && outcome.error.condition === "unique_violation") {
      return yield* new PersistenceConflict({
        operation,
        constraint: outcome.error.constraint ?? undefined,
      });
    }

    if (outcome.error !== undefined) {
      return yield* classifyDatabaseError(operation, outcome.error.cause);
    }

    return yield* new PersistenceError({ operation, cause: "unexpected insert outcome" });
  });

export const DishRepositoryLive = Layer.succeed(DishRepository, {
  findById: (id) =>
    Effect.gen(function* () {
      const row = yield* runQuery("dish/find-by-id", (sql) => dishFindById.run(sql, { id }));

      return row;
    }),
  findBySlug: (slug) =>
    Effect.gen(function* () {
      const row = yield* runQuery("dish/find-by-slug", (sql) => dishFindBySlug.run(sql, { slug }));

      return row;
    }),
  findByIds: (ids) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/find-by-ids", (sql) =>
        dishFindByIds.run(sql, { ids: [...ids] }),
      );

      return rows.map((row) => row.id);
    }),
  recordsByIds: (ids) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/records-by-ids", (sql) =>
        dishRecordsByIds.run(sql, { ids: [...ids] }),
      );

      return rows;
    }),
  listByStatus: (status, cursor, limit) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/list-by-status", (sql) =>
        dishListByStatus.run(sql, { status, cursor, limit }),
      );

      return rows;
    }),
  countByStatus: (status) =>
    Effect.gen(function* () {
      const row = yield* runQuery("dish/count-by-status", (sql) =>
        dishCountByStatus.run(sql, { status }),
      );

      return row.total;
    }),
  missingIngredientsCount: () =>
    Effect.gen(function* () {
      const row = yield* runQuery("dish/missing-ingredients-count", (sql) =>
        adminDishesMissingIngredientsCount.run(sql),
      );

      return row.total;
    }),
  recentAdminDishes: (limit) =>
    runQuery("dish/admin-recent", (sql) => adminDishesRecent.run(sql, { limit })),
  listAdminDishes: (status, cursor, limit) =>
    runQuery("dish/admin-by-status", (sql) =>
      adminDishesByStatus.run(sql, { status, cursor, limit }),
    ),
  searchIds: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/search", (sql) =>
        dishSearch.run(sql, {
          q: input.q,
          prefix: input.prefix,
          contains: input.contains,
          status: input.status,
          tier: input.tier,
          cursor: input.cursor,
          limit: input.limit,
        }),
      );
    }),
  searchRecentIds: (input) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/search-recent", (sql) =>
        dishSearchRecent.run(sql, {
          q: input.q,
          prefix: input.prefix,
          contains: input.contains,
          status: input.status,
          updated: input.updated,
          cursor: input.cursor,
          limit: input.limit,
        }),
      );

      return rows.map((row) => row.id);
    }),
  browseIds: (input) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/browse", (sql) =>
        dishBrowse.run(sql, {
          status: input.status,
          updated: input.updated,
          cursor: input.cursor,
          limit: input.limit,
        }),
      );

      return rows.map((row) => row.id);
    }),
  resolveByNameKey: (key, limit) =>
    Effect.gen(function* () {
      const rows = yield* runQuery("dish/name-resolve", (sql) =>
        dishNameResolve.run(sql, { key, limit }),
      );

      return rows.map((row) => row.dish_id);
    }),
  relatedIds: (id, status, limit) =>
    Effect.gen(function* () {
      return yield* runQuery("dish/related", (sql) => dishRelated.run(sql, { id, status, limit }));
    }),
  insert: (input) =>
    Effect.gen(function* () {
      const outcome = yield* runQuery("dish/insert", (sql) =>
        dishInsert.try(sql, {
          slug: input.slug,
          parent_dish_id: input.parentDishId,
          status: input.status,
        }),
      );

      if (outcome.error !== undefined) {
        return yield* insertConflict("dish/insert", outcome);
      }

      return outcome.value;
    }),
  update: (input) =>
    Effect.gen(function* () {
      const outcome = yield* runQuery("dish/update", (sql) =>
        dishUpdate.try(sql, {
          id: input.id,
          slug: input.slug,
          parent_dish_id: input.parentDishId,
          status: input.status,
        }),
      );

      if (outcome.error !== undefined) {
        return yield* insertConflict("dish/update", outcome);
      }

      return outcome.value;
    }),
  updateStatus: (id, status) =>
    Effect.gen(function* () {
      const row = yield* runQuery("dish/update-status", (sql) =>
        dishUpdateStatus.run(sql, { id, status }),
      );

      return row;
    }),
});
