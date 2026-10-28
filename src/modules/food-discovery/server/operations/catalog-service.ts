import { Context, Effect, Layer } from "effect";

import {
  IngredientNotFound,
  InvalidLocale,
  InvalidSearchFilter,
  PlaceNotFound,
} from "@/modules/food-discovery/server/domain/errors";
import {
  encodeDbId,
  isDbIdString,
  isLanguageTag,
} from "@/modules/food-discovery/server/domain/ids";
import {
  asLocalizedName,
  isSearchableQuery,
  normalizeSearchKey,
  pickDisplayName,
  toContainsKey,
  toPrefixKey,
} from "@/modules/food-discovery/server/domain/search";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import { PlaceRepository } from "@/modules/food-discovery/server/repository/place-repository";
import { TaxonomyRepository } from "@/modules/food-discovery/server/repository/taxonomy-repository";
import type { Database } from "@/server/database/client";
import type {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
  TransactionConflict,
} from "@/server/database/errors";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
};

const checkLocale = (locale: string): Effect.Effect<string, InvalidLocale> =>
  isLanguageTag(locale) ? Effect.succeed(locale) : Effect.fail(new InvalidLocale({ locale }));

export type CatalogServiceError =
  | IngredientNotFound
  | InvalidLocale
  | InvalidSearchFilter
  | PlaceNotFound
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionConflict;

export interface IngredientSummary {
  readonly id: string;
  readonly displayName: string | undefined;
  readonly displayLanguage: string | undefined;
}

export interface IngredientDetail extends IngredientSummary {
  readonly names: ReadonlyArray<{
    readonly languageTag: string;
    readonly name: string;
    readonly nameKind: string;
    readonly isPreferred: boolean;
  }>;
}

export interface PlaceSummary {
  readonly id: string;
  readonly kind: string;
  readonly iso3166: string | null;
  readonly displayName: string | undefined;
  readonly displayLatitude: number | null;
  readonly displayLongitude: number | null;
}

export interface CategorySummary {
  readonly id: string;
  readonly kind: string;
  readonly slug: string;
  readonly displayName: string | undefined;
}

export interface CuisineSummary {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string | undefined;
}

export interface PlaceDetail extends PlaceSummary {
  readonly names: ReadonlyArray<{
    readonly languageTag: string;
    readonly name: string;
    readonly isPreferred: boolean;
  }>;
  readonly ancestors: ReadonlyArray<PlaceSummary>;
}

export class CatalogService extends Context.Service<
  CatalogService,
  {
    readonly searchIngredients: (
      q: string,
      locale: string,
      limit: number | undefined,
    ) => Effect.Effect<ReadonlyArray<IngredientSummary>, CatalogServiceError, Database>;
    readonly getIngredient: (
      id: string,
      locale: string,
    ) => Effect.Effect<IngredientDetail, CatalogServiceError, Database>;
    readonly searchPlaces: (
      q: string,
      locale: string,
      limit: number | undefined,
    ) => Effect.Effect<ReadonlyArray<PlaceSummary>, CatalogServiceError, Database>;
    readonly getPlace: (
      id: string,
      locale: string,
    ) => Effect.Effect<PlaceDetail, CatalogServiceError, Database>;
    readonly listPlaces: (
      locale: string,
      limit: number | undefined,
    ) => Effect.Effect<ReadonlyArray<PlaceSummary>, CatalogServiceError, Database>;
    readonly listCategories: (
      locale: string,
    ) => Effect.Effect<ReadonlyArray<CategorySummary>, CatalogServiceError, Database>;
    readonly listCuisines: (
      locale: string,
    ) => Effect.Effect<ReadonlyArray<CuisineSummary>, CatalogServiceError, Database>;
  }
>()("feastjourney/food-discovery/CatalogService") {}

const toPlaceSummary = (
  record: {
    readonly id: bigint;
    readonly kind: string;
    readonly iso3166: string | null;
    readonly displayLatitude: number | null;
    readonly displayLongitude: number | null;
  },
  names: ReadonlyArray<{
    readonly language_tag: string;
    readonly name: string;
    readonly is_preferred: boolean;
  }>,
  locale: string,
): PlaceSummary => ({
  id: encodeDbId(record.id),
  kind: record.kind,
  iso3166: record.iso3166,
  displayName: pickDisplayName(names.map(asLocalizedName), locale)?.name,
  displayLatitude: record.displayLatitude,
  displayLongitude: record.displayLongitude,
});

export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function* () {
    const ingredientRepository = yield* IngredientRepository;
    const placeRepository = yield* PlaceRepository;
    const taxonomy = yield* TaxonomyRepository;

    const searchIngredients = (
      q: string,
      locale: string,
      limit: number | undefined,
    ): Effect.Effect<ReadonlyArray<IngredientSummary>, CatalogServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);

        if (!isSearchableQuery(q)) {
          return yield* new InvalidSearchFilter({ reason: "q must be 1-200 characters" });
        }

        const key = normalizeSearchKey(q.trim());

        if (key.length === 0) {
          return yield* new InvalidSearchFilter({ reason: "q has no searchable text" });
        }

        const rows = yield* ingredientRepository.searchIds({
          q: key,
          prefix: toPrefixKey(key),
          contains: toContainsKey(key),
          limit: clampLimit(limit),
        });

        const ids = rows.map((row) => row.id);

        if (ids.length === 0) {
          return [];
        }

        const names = yield* ingredientRepository.namesByIngredientIds(ids);
        const byIngredient = new Map<string, Array<(typeof names)[number]>>();

        for (const entry of names) {
          const keyId = entry.ingredient_id.toString();
          const existing = byIngredient.get(keyId);

          if (existing === undefined) {
            byIngredient.set(keyId, [entry]);
          } else {
            existing.push(entry);
          }
        }

        const summaries: Array<IngredientSummary> = [];

        for (const row of rows) {
          const record = yield* ingredientRepository.findById(row.id);

          if (record === null) {
            continue;
          }

          const labels = byIngredient.get(row.id.toString()) ?? [];
          const picked = pickDisplayName(labels.map(asLocalizedName), checkedLocale);
          summaries.push({
            id: encodeDbId(record.id),
            displayName: picked?.name,
            displayLanguage: picked?.languageTag,
          });
        }

        return summaries;
      });

    const getIngredient = (
      id: string,
      locale: string,
    ): Effect.Effect<IngredientDetail, CatalogServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);

        if (!isDbIdString(id)) {
          return yield* new IngredientNotFound({ ingredientId: id });
        }

        const record = yield* ingredientRepository.findById(BigInt(id));

        if (record === null) {
          return yield* new IngredientNotFound({ ingredientId: id });
        }

        const names = yield* ingredientRepository.namesByIngredientIds([record.id]);
        const picked = pickDisplayName(names.map(asLocalizedName), checkedLocale);

        return {
          id: encodeDbId(record.id),
          displayName: picked?.name,
          displayLanguage: picked?.languageTag,
          names: names.map((entry) => ({
            languageTag: entry.language_tag,
            name: entry.name,
            nameKind: entry.name_kind,
            isPreferred: entry.is_preferred,
          })),
        };
      });

    const searchPlaces = (
      q: string,
      locale: string,
      limit: number | undefined,
    ): Effect.Effect<ReadonlyArray<PlaceSummary>, CatalogServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);

        if (!isSearchableQuery(q)) {
          return yield* new InvalidSearchFilter({ reason: "q must be 1-200 characters" });
        }

        const key = normalizeSearchKey(q.trim());

        if (key.length === 0) {
          return yield* new InvalidSearchFilter({ reason: "q has no searchable text" });
        }

        const rows = yield* placeRepository.searchIds({
          q: key,
          prefix: toPrefixKey(key),
          contains: toContainsKey(key),
          limit: clampLimit(limit),
        });

        const ids = rows.map((row) => row.id);

        if (ids.length === 0) {
          return [];
        }

        const names = yield* placeRepository.namesByPlaceIds(ids);
        const byPlace = new Map<string, Array<(typeof names)[number]>>();

        for (const entry of names) {
          const keyId = entry.place_id.toString();
          const existing = byPlace.get(keyId);

          if (existing === undefined) {
            byPlace.set(keyId, [entry]);
          } else {
            existing.push(entry);
          }
        }

        const summaries: Array<PlaceSummary> = [];

        for (const row of rows) {
          const record = yield* placeRepository.findById(row.id);

          if (record === null) {
            continue;
          }

          summaries.push(
            toPlaceSummary(record, byPlace.get(row.id.toString()) ?? [], checkedLocale),
          );
        }

        return summaries;
      });

    const getPlace = (
      id: string,
      locale: string,
    ): Effect.Effect<PlaceDetail, CatalogServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);

        if (!isDbIdString(id)) {
          return yield* new PlaceNotFound({ placeId: id });
        }

        const record = yield* placeRepository.findById(BigInt(id));

        if (record === null) {
          return yield* new PlaceNotFound({ placeId: id });
        }

        const names = yield* placeRepository.namesByPlaceIds([record.id]);

        return {
          ...toPlaceSummary(record, names, checkedLocale),
          names: names.map((entry) => ({
            languageTag: entry.language_tag,
            name: entry.name,
            isPreferred: entry.is_preferred,
          })),
          ancestors: [],
        };
      });

    const listPlaces = (
      locale: string,
      limit: number | undefined,
    ): Effect.Effect<ReadonlyArray<PlaceSummary>, CatalogServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);
        const rows = yield* placeRepository.listWithNames(clampLimit(limit));

        const byPlace = new Map<
          string,
          {
            readonly kind: string;
            readonly iso3166: string | null;
            readonly displayLatitude: number | null;
            readonly displayLongitude: number | null;
            readonly names: Array<{
              readonly languageTag: string;
              readonly name: string;
              readonly isPreferred: boolean;
            }>;
          }
        >();

        for (const row of rows) {
          const key = row.id.toString();
          const existing = byPlace.get(key);

          const label = {
            languageTag: row.language_tag,
            name: row.name,
            isPreferred: row.is_preferred,
          };

          if (existing === undefined) {
            byPlace.set(key, {
              kind: row.kind,
              iso3166: row.iso3166,
              displayLatitude: row.display_latitude,
              displayLongitude: row.display_longitude,
              names: [label],
            });
          } else {
            existing.names.push(label);
          }
        }

        return [...byPlace].map(([id, entry]) => ({
          id,
          kind: entry.kind,
          iso3166: entry.iso3166,
          displayName: pickDisplayName(entry.names, checkedLocale)?.name,
          displayLatitude: entry.displayLatitude,
          displayLongitude: entry.displayLongitude,
        }));
      });

    const listCategories = (
      locale: string,
    ): Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly kind: string;
        readonly slug: string;
        readonly displayName: string | undefined;
      }>,
      CatalogServiceError,
      Database
    > =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);
        const rows = yield* taxonomy.categories();

        const byCategory = new Map<
          string,
          {
            readonly kind: string;
            readonly slug: string;
            readonly names: Array<{
              readonly languageTag: string;
              readonly name: string;
              readonly isPreferred: boolean;
            }>;
          }
        >();

        for (const row of rows) {
          const key = row.id.toString();
          const existing = byCategory.get(key);

          const label = {
            languageTag: row.language_tag,
            name: row.name,
            isPreferred: row.is_preferred,
          };

          if (existing === undefined) {
            byCategory.set(key, { kind: row.kind, slug: row.slug, names: [label] });
          } else {
            existing.names.push(label);
          }
        }

        return [...byCategory].map(([id, entry]) => ({
          id,
          kind: entry.kind,
          slug: entry.slug,
          displayName: pickDisplayName(entry.names, checkedLocale)?.name,
        }));
      });

    const listCuisines = (
      locale: string,
    ): Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly slug: string;
        readonly displayName: string | undefined;
      }>,
      CatalogServiceError,
      Database
    > =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);
        const rows = yield* taxonomy.cuisines();

        const byCuisine = new Map<
          string,
          {
            readonly slug: string;
            readonly names: Array<{
              readonly languageTag: string;
              readonly name: string;
              readonly isPreferred: boolean;
            }>;
          }
        >();

        for (const row of rows) {
          const key = row.id.toString();
          const existing = byCuisine.get(key);

          const label = {
            languageTag: row.language_tag,
            name: row.name,
            isPreferred: row.is_preferred,
          };

          if (existing === undefined) {
            byCuisine.set(key, { slug: row.slug, names: [label] });
          } else {
            existing.names.push(label);
          }
        }

        return [...byCuisine].map(([id, entry]) => ({
          id,
          slug: entry.slug,
          displayName: pickDisplayName(entry.names, checkedLocale)?.name,
        }));
      });

    return CatalogService.of({
      searchIngredients,
      getIngredient,
      searchPlaces,
      getPlace,
      listPlaces,
      listCategories,
      listCuisines,
    });
  }),
);
