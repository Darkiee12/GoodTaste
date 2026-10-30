import { Context, Effect, Layer } from "effect";

import categoryFindBySlugs from "@/modules/food-discovery/server/repository/sql/category-find-by-slugs.sql";
import categoryListWithNames from "@/modules/food-discovery/server/repository/sql/category-list-with-names.sql";
import cuisineFindBySlug from "@/modules/food-discovery/server/repository/sql/cuisine-find-by-slug.sql";
import cuisineListWithNames from "@/modules/food-discovery/server/repository/sql/cuisine-list-with-names.sql";
import sourceProviderFindBySlug from "@/modules/food-discovery/server/repository/sql/source-provider-find-by-slug.sql";
import sourceRecordUpsert from "@/modules/food-discovery/server/repository/sql/source-record-upsert.sql";
import type { Database } from "@/server/database/client";
import { type DatabaseError, runQuery } from "@/server/database/query";

export type CategoryListRow = (typeof categoryListWithNames)["~reylo"]["element"];

export type CuisineListRow = (typeof cuisineListWithNames)["~reylo"]["element"];

export class TaxonomyRepository extends Context.Service<
  TaxonomyRepository,
  {
    readonly categories: () => Effect.Effect<
      ReadonlyArray<CategoryListRow>,
      DatabaseError,
      Database
    >;
    readonly cuisines: () => Effect.Effect<ReadonlyArray<CuisineListRow>, DatabaseError, Database>;
    readonly categoriesBySlugs: (
      slugs: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: bigint; readonly slug: string; readonly kind: string }>,
      DatabaseError,
      Database
    >;
    readonly cuisineBySlug: (
      slug: string,
    ) => Effect.Effect<
      { readonly id: bigint; readonly slug: string } | null,
      DatabaseError,
      Database
    >;
  }
>()("feastjourney/food-discovery/TaxonomyRepository") {}

export const TaxonomyRepositoryLive = Layer.succeed(TaxonomyRepository, {
  categories: () =>
    Effect.gen(function* () {
      return yield* runQuery("taxonomy/categories", (sql) => categoryListWithNames.run(sql));
    }),
  cuisines: () =>
    Effect.gen(function* () {
      return yield* runQuery("taxonomy/cuisines", (sql) => cuisineListWithNames.run(sql));
    }),
  categoriesBySlugs: (slugs) =>
    Effect.gen(function* () {
      return yield* runQuery("taxonomy/categories-by-slugs", (sql) =>
        categoryFindBySlugs.run(sql, { slugs: [...slugs] }),
      );
    }),
  cuisineBySlug: (slug) =>
    Effect.gen(function* () {
      return yield* runQuery("taxonomy/cuisine-by-slug", (sql) =>
        cuisineFindBySlug.run(sql, { slug }),
      );
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
      DatabaseError,
      Database
    >;
    readonly upsertRecord: (
      input: SourceRecordInput,
    ) => Effect.Effect<{ readonly id: bigint }, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/SourceRepository") {}

export const SourceRepositoryLive = Layer.succeed(SourceRepository, {
  providerBySlug: (slug) =>
    Effect.gen(function* () {
      const row = yield* runQuery("source/provider-by-slug", (sql) =>
        sourceProviderFindBySlug.run(sql, { slug }),
      );

      if (row === null) {
        return null;
      }

      return { id: row.id, slug: row.slug };
    }),
  upsertRecord: (input) =>
    Effect.gen(function* () {
      const row = yield* runQuery("source/record-upsert", (sql) =>
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
      );

      return { id: row.id };
    }),
});
