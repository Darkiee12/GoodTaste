import { Context, Effect, Layer } from "effect";

import categoryFindBySlugs from "@/modules/food-discovery/server/repository/sql/category-find-by-slugs.sql";
import categoryListWithNames from "@/modules/food-discovery/server/repository/sql/category-list-with-names.sql";
import cuisineFindBySlug from "@/modules/food-discovery/server/repository/sql/cuisine-find-by-slug.sql";
import cuisineListWithNames from "@/modules/food-discovery/server/repository/sql/cuisine-list-with-names.sql";
import sourceProviderFindBySlug from "@/modules/food-discovery/server/repository/sql/source-provider-find-by-slug.sql";
import sourceRecordUpsert from "@/modules/food-discovery/server/repository/sql/source-record-upsert.sql";
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import { DatabaseUnavailable, PersistenceError } from "@/server/database/errors";

export type CategoryListRow = (typeof categoryListWithNames)["~reylo"]["element"];

export type CuisineListRow = (typeof cuisineListWithNames)["~reylo"]["element"];

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

export class TaxonomyRepository extends Context.Service<
  TaxonomyRepository,
  {
    readonly categories: () => Effect.Effect<
      ReadonlyArray<CategoryListRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly cuisines: () => Effect.Effect<
      ReadonlyArray<CuisineListRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly categoriesBySlugs: (
      slugs: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly slug: string; readonly kind: string }>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly cuisineBySlug: (
      slug: string,
    ) => Effect.Effect<
      { readonly id: bigint; readonly slug: string } | null,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
  }
>()("feastjourney/food-discovery/TaxonomyRepository") {}

export const TaxonomyRepositoryLive = Layer.succeed(TaxonomyRepository, {
  categories: () =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => categoryListWithNames.run(sql),
        catch: (cause) => readFailure("taxonomy/categories", cause),
      });

      return toArray(rows);
    }),
  cuisines: () =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => cuisineListWithNames.run(sql),
        catch: (cause) => readFailure("taxonomy/cuisines", cause),
      });

      return toArray(rows);
    }),
  categoriesBySlugs: (slugs) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => categoryFindBySlugs.run(sql, { slugs: [...slugs] }),
        catch: (cause) => readFailure("taxonomy/categories-by-slugs", cause),
      });

      return toArray(rows);
    }),
  cuisineBySlug: (slug) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => cuisineFindBySlug.run(sql, { slug }),
        catch: (cause) => readFailure("taxonomy/cuisine-by-slug", cause),
      });

      return row;
    }),
});

export interface SourceRecordInput {
  readonly providerId: bigint;
  readonly externalId: string;
  readonly canonicalUrl: string | null;
  readonly retrievedAt: string;
  readonly revision: string | null;
  readonly license: string | null;
  readonly attribution: string | null;
  readonly importStatus: string;
  readonly payload: string | null;
}

export class SourceRepository extends Context.Service<
  SourceRepository,
  {
    readonly providerBySlug: (
      slug: string,
    ) => Effect.Effect<
      { readonly id: bigint; readonly slug: string } | null,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly upsertRecord: (
      input: SourceRecordInput,
    ) => Effect.Effect<{ readonly id: bigint }, DatabaseUnavailable | PersistenceError, Database>;
  }
>()("feastjourney/food-discovery/SourceRepository") {}

export const SourceRepositoryLive = Layer.succeed(SourceRepository, {
  providerBySlug: (slug) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => sourceProviderFindBySlug.run(sql, { slug }),
        catch: (cause) => readFailure("source/provider-by-slug", cause),
      });

      if (row === null) {
        return null;
      }

      return { id: row.id, slug: row.slug };
    }),
  upsertRecord: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          sourceRecordUpsert.run(sql, {
            provider_id: input.providerId,
            external_id: input.externalId,
            canonical_url: input.canonicalUrl,
            retrieved_at: input.retrievedAt,
            revision: input.revision,
            license: input.license,
            attribution: input.attribution,
            import_status: input.importStatus,
            payload: input.payload,
          }),
        catch: (cause) => readFailure("source/record-upsert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "source/record-upsert",
          cause: "upsert returned no row",
        });
      }

      return { id: first.id };
    }),
});
