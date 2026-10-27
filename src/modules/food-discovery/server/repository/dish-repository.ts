import { Context, Effect, Layer } from "effect";

import { encodeDbId } from "@/modules/food-discovery/server/domain/ids";
import dishBrowse from "@/modules/food-discovery/server/repository/sql/dish-browse.sql";
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
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
} from "@/server/database/errors";

export type DishRow = (typeof dishFindById)["~reylo"]["element"];

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

export interface DishRecord {
  readonly id: bigint;
  readonly slug: string;
  readonly parentDishId: bigint | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const toRecord = (row: DishRow): DishRecord => ({
  id: row.id,
  slug: row.slug,
  parentDishId: row.parent_dish_id,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const dishRecordId = (record: DishRecord): string => encodeDbId(record.id);

export class DishRepository extends Context.Service<
  DishRepository,
  {
    readonly findById: (
      id: bigint,
    ) => Effect.Effect<DishRecord | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly findBySlug: (
      slug: string,
    ) => Effect.Effect<DishRecord | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly findByIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly recordsByIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishRecord>, DatabaseUnavailable | PersistenceError, Database>;
    readonly listByStatus: (
      status: string,
      cursor: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<DishRecord>, DatabaseUnavailable | PersistenceError, Database>;
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
      DatabaseUnavailable | PersistenceError,
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
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly browseIds: (input: {
      readonly status: string;
      readonly updated: string;
      readonly cursor: bigint;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly resolveByNameKey: (
      key: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly relatedIds: (
      id: bigint,
      status: string,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly shared: number }>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly insert: (input: {
      readonly slug: string;
      readonly parentDishId: bigint | null;
      readonly status: string;
    }) => Effect.Effect<
      DishRecord,
      DatabaseUnavailable | PersistenceError | PersistenceConflict,
      Database
    >;
    readonly update: (input: {
      readonly id: bigint;
      readonly slug: string;
      readonly parentDishId: bigint | null;
      readonly status: string;
    }) => Effect.Effect<
      DishRecord | null,
      DatabaseUnavailable | PersistenceError | PersistenceConflict,
      Database
    >;
    readonly updateStatus: (
      id: bigint,
      status: string,
    ) => Effect.Effect<DishRecord | null, DatabaseUnavailable | PersistenceError, Database>;
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
): Effect.Effect<never, PersistenceConflict | DatabaseUnavailable | PersistenceError> =>
  Effect.gen(function* () {
    if (outcome.error !== undefined && outcome.error.condition === "unique_violation") {
      return yield* new PersistenceConflict({
        operation,
        constraint: outcome.error.constraint ?? undefined,
      });
    }

    if (outcome.error !== undefined) {
      return yield* readFailure(operation, outcome.error.cause);
    }

    return yield* new PersistenceError({ operation, cause: "unexpected insert outcome" });
  });

export const DishRepositoryLive = Layer.succeed(DishRepository, {
  findById: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => dishFindById.run(sql, { id }),
        catch: (cause) => readFailure("dish/find-by-id", cause),
      });

      return row === null ? null : toRecord(row);
    }),
  findBySlug: (slug) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => dishFindBySlug.run(sql, { slug }),
        catch: (cause) => readFailure("dish/find-by-slug", cause),
      });

      return row === null ? null : toRecord(row);
    }),
  findByIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishFindByIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/find-by-ids", cause),
      });

      return toArray(rows).map((row) => row.id);
    }),
  recordsByIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishRecordsByIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("dish/records-by-ids", cause),
      });

      return toArray(rows).map(toRecord);
    }),
  listByStatus: (status, cursor, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishListByStatus.run(sql, { status, cursor, limit }),
        catch: (cause) => readFailure("dish/list-by-status", cause),
      });

      return toArray(rows).map(toRecord);
    }),
  searchIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          dishSearch.run(sql, {
            q: input.q,
            prefix: input.prefix,
            contains: input.contains,
            status: input.status,
            tier: input.tier,
            cursor: input.cursor,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("dish/search", cause),
      });

      return toArray(rows);
    }),
  searchRecentIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          dishSearchRecent.run(sql, {
            q: input.q,
            prefix: input.prefix,
            contains: input.contains,
            status: input.status,
            updated: input.updated,
            cursor: input.cursor,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("dish/search-recent", cause),
      });

      return toArray(rows).map((row) => row.id);
    }),
  browseIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          dishBrowse.run(sql, {
            status: input.status,
            updated: input.updated,
            cursor: input.cursor,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("dish/browse", cause),
      });

      return toArray(rows).map((row) => row.id);
    }),
  resolveByNameKey: (key, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishNameResolve.run(sql, { key, limit }),
        catch: (cause) => readFailure("dish/name-resolve", cause),
      });

      return toArray(rows).map((row) => row.dish_id);
    }),
  relatedIds: (id, status, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => dishRelated.run(sql, { id, status, limit }),
        catch: (cause) => readFailure("dish/related", cause),
      });

      return toArray(rows);
    }),
  insert: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const outcome = yield* Effect.tryPromise({
        try: () =>
          dishInsert.try(sql, {
            slug: input.slug,
            parent_dish_id: input.parentDishId,
            status: input.status,
          }),
        catch: (cause) => readFailure("dish/insert", cause),
      });

      if (outcome.error !== undefined) {
        return yield* insertConflict("dish/insert", outcome);
      }

      const created = toArray(outcome.value);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "dish/insert",
          cause: "insert returned no row",
        });
      }

      return toRecord(first);
    }),
  update: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const outcome = yield* Effect.tryPromise({
        try: () =>
          dishUpdate.try(sql, {
            id: input.id,
            slug: input.slug,
            parent_dish_id: input.parentDishId,
            status: input.status,
          }),
        catch: (cause) => readFailure("dish/update", cause),
      });

      if (outcome.error !== undefined) {
        return yield* insertConflict("dish/update", outcome);
      }

      const updated = outcome.value === null ? [] : toArray(outcome.value);
      const first = updated[0];

      return first === undefined ? null : toRecord(first);
    }),
  updateStatus: (id, status) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => dishUpdateStatus.run(sql, { id, status }),
        catch: (cause) => readFailure("dish/update-status", cause),
      });

      return row === null ? null : toRecord(row);
    }),
});
