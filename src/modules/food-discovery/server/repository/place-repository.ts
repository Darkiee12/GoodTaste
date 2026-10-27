import { Context, Effect, Layer } from "effect";

import placeFindById from "@/modules/food-discovery/server/repository/sql/place-find-by-id.sql";
import placeFindByIso from "@/modules/food-discovery/server/repository/sql/place-find-by-iso.sql";
import placeFindDescendants from "@/modules/food-discovery/server/repository/sql/place-find-descendants.sql";
import placeFindDishIds from "@/modules/food-discovery/server/repository/sql/place-find-dish-ids.sql";
import placeListWithNames from "@/modules/food-discovery/server/repository/sql/place-list-with-names.sql";
import placeNamesByPlaceIds from "@/modules/food-discovery/server/repository/sql/place-names-by-place-ids.sql";
import placeParentsAll from "@/modules/food-discovery/server/repository/sql/place-parents-all.sql";
import placeSearch from "@/modules/food-discovery/server/repository/sql/place-search.sql";
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import { DatabaseUnavailable, PersistenceError } from "@/server/database/errors";

export type PlaceRow = (typeof placeFindById)["~reylo"]["element"];

export type PlaceNameRow = (typeof placeNamesByPlaceIds)["~reylo"]["element"];

export type PlaceListRow = (typeof placeListWithNames)["~reylo"]["element"];

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

export interface PlaceRecord {
  readonly id: bigint;
  readonly kind: string;
  readonly iso3166: string | null;
  readonly displayLatitude: number | null;
  readonly displayLongitude: number | null;
  readonly displayNote: string | null;
}

const toRecord = (row: PlaceRow): PlaceRecord => ({
  id: row.id,
  kind: row.kind,
  iso3166: row.iso3166,
  displayLatitude: row.display_latitude,
  displayLongitude: row.display_longitude,
  displayNote: row.display_note,
});

export class PlaceRepository extends Context.Service<
  PlaceRepository,
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
    ) => Effect.Effect<PlaceRecord | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly findByIso: (
      iso: string,
    ) => Effect.Effect<PlaceRecord | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly namesByPlaceIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<
      ReadonlyArray<PlaceNameRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly descendants: (
      id: bigint,
    ) => Effect.Effect<
      ReadonlyArray<PlaceRecord>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly descendantIds: (
      id: bigint,
    ) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly dishIdsByPlace: (input: {
      readonly placeId: bigint;
      readonly status: string;
      readonly association: string | null;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<bigint>, DatabaseUnavailable | PersistenceError, Database>;
    readonly listWithNames: (
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<PlaceListRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly parentEdges: () => Effect.Effect<
      ReadonlyArray<{ readonly placeId: bigint; readonly parentPlaceId: bigint }>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
  }
>()("feastjourney/food-discovery/PlaceRepository") {}

export const PlaceRepositoryLive = Layer.succeed(PlaceRepository, {
  searchIds: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          placeSearch.run(sql, {
            q: input.q,
            prefix: input.prefix,
            contains: input.contains,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("place/search", cause),
      });

      return toArray(rows);
    }),
  findById: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => placeFindById.run(sql, { id }),
        catch: (cause) => readFailure("place/find-by-id", cause),
      });

      return row === null ? null : toRecord(row);
    }),
  findByIso: (iso) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeFindByIso.run(sql, { iso }),
        catch: (cause) => readFailure("place/find-by-iso", cause),
      });

      const first = toArray(rows)[0];

      return first === undefined
        ? null
        : {
            id: first.id,
            kind: first.kind,
            iso3166: first.iso3166,
            displayLatitude: first.display_latitude,
            displayLongitude: first.display_longitude,
            displayNote: first.display_note,
          };
    }),
  namesByPlaceIds: (ids) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeNamesByPlaceIds.run(sql, { ids: [...ids] }),
        catch: (cause) => readFailure("place/names-by-ids", cause),
      });

      return toArray(rows);
    }),
  descendants: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeFindDescendants.run(sql, { id }),
        catch: (cause) => readFailure("place/descendants", cause),
      });

      return toArray(rows).map((row) => ({
        id: row.id,
        kind: row.kind,
        iso3166: row.iso3166,
        displayLatitude: row.display_latitude,
        displayLongitude: row.display_longitude,
        displayNote: row.display_note,
      }));
    }),
  descendantIds: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeFindDescendants.run(sql, { id }),
        catch: (cause) => readFailure("place/descendants", cause),
      });

      return toArray(rows).map((row) => row.id);
    }),
  dishIdsByPlace: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () =>
          placeFindDishIds.run(sql, {
            place_id: input.placeId,
            status: input.status,
            association: input.association,
            limit: input.limit,
          }),
        catch: (cause) => readFailure("place/dish-ids", cause),
      });

      return toArray(rows).map((row) => row.dish_id);
    }),
  listWithNames: (limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeListWithNames.run(sql, { limit }),
        catch: (cause) => readFailure("place/list", cause),
      });

      return toArray(rows);
    }),
  parentEdges: () =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => placeParentsAll.run(sql),
        catch: (cause) => readFailure("place/parents", cause),
      });

      return toArray(rows).map((row) => ({
        placeId: row.place_id,
        parentPlaceId: row.parent_place_id,
      }));
    }),
});
