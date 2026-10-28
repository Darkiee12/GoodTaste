import { Context, Effect, Layer } from "effect";

import type { DishProfile, DishSummary } from "@/modules/food-discovery/server/domain/dish";
import {
  DishNotFound,
  InvalidLocale,
  InvalidSearchFilter,
  PlaceNotFound,
} from "@/modules/food-discovery/server/domain/errors";
import {
  encodeDbId,
  isDbIdString,
  isLanguageTag,
  isSlug,
} from "@/modules/food-discovery/server/domain/ids";
import {
  isSearchableQuery,
  normalizeSearchKey,
  pickDisplayName,
  toContainsKey,
  toPrefixKey,
  asLocalizedName,
} from "@/modules/food-discovery/server/domain/search";
import {
  decodeBrowseCursor,
  decodeFilterCursor,
  decodeSearchCursor,
  encodeCursor,
} from "@/modules/food-discovery/server/operations/cursor";
import type {
  DishNameRow,
  DishPlaceRow,
} from "@/modules/food-discovery/server/repository/dish-relations-repository";
import { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import type { DishRecord } from "@/modules/food-discovery/server/repository/dish-repository";
import { DishRepository } from "@/modules/food-discovery/server/repository/dish-repository";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import type { PlaceNameRow } from "@/modules/food-discovery/server/repository/place-repository";
import { PlaceRepository } from "@/modules/food-discovery/server/repository/place-repository";
import { TaxonomyRepository } from "@/modules/food-discovery/server/repository/taxonomy-repository";
import type { Database } from "@/server/database/client";
import type {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
  TransactionConflict,
} from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FAR_FUTURE = "9999-12-31T23:59:59.999Z";

const clampLimit = (limit: number | undefined, fallback: number): number => {
  if (limit === undefined || Number.isNaN(limit)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
};

const checkLocale = (locale: string): Effect.Effect<string, InvalidLocale> =>
  isLanguageTag(locale) ? Effect.succeed(locale) : Effect.fail(new InvalidLocale({ locale }));

const unixSeconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const groupByDish = <Row>(
  rows: ReadonlyArray<Row>,
  key: (row: Row) => bigint,
): ReadonlyMap<string, Array<Row>> => {
  const groups = new Map<string, Array<Row>>();

  for (const row of rows) {
    const groupKey = key(row).toString();
    const existing = groups.get(groupKey);

    if (existing === undefined) {
      groups.set(groupKey, [row]);
    } else {
      existing.push(row);
    }
  }

  return groups;
};

const englishNameOf = (names: ReadonlyArray<DishNameRow>): string | undefined => {
  const preferred = names.find((entry) => entry.language_tag === "en" && entry.is_preferred);

  return (preferred ?? names.find((entry) => entry.language_tag === "en"))?.name;
};

const displayNameOf = (names: ReadonlyArray<DishNameRow>, locale: string) => {
  const picked = pickDisplayName(names.map(asLocalizedName), locale);

  if (picked === undefined) {
    return { name: undefined, language: undefined };
  }

  return { name: picked.name, language: picked.languageTag };
};

export type DishServiceError =
  | DishNotFound
  | InvalidLocale
  | InvalidSearchFilter
  | PlaceNotFound
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionConflict;

export interface SearchDishesInput {
  readonly q?: string | undefined;
  readonly locale?: string | undefined;
  readonly ingredientIds?: ReadonlyArray<string> | undefined;
  readonly ingredientMode?: string | undefined;
  readonly categorySlugs?: ReadonlyArray<string> | undefined;
  readonly categoryMode?: string | undefined;
  readonly cuisine?: string | undefined;
  readonly country?: string | undefined;
  readonly region?: string | undefined;
  readonly placeId?: string | undefined;
  readonly association?: string | undefined;
  readonly sort?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface SearchDishesOutput {
  readonly items: ReadonlyArray<DishSummary>;
  readonly nextCursor: string | null;
}

export class DishService extends Context.Service<
  DishService,
  {
    readonly getDish: (
      idOrSlug: string,
      locale: string,
    ) => Effect.Effect<DishProfile, DishServiceError, Database>;
    readonly searchDishes: (
      input: SearchDishesInput,
    ) => Effect.Effect<SearchDishesOutput, DishServiceError, Database>;
    readonly getRelated: (
      idOrSlug: string,
      locale: string,
      limit: number | undefined,
    ) => Effect.Effect<ReadonlyArray<DishSummary>, DishServiceError, Database>;
  }
>()("feastjourney/food-discovery/DishService") {}

const toSummaries = (
  records: ReadonlyMap<string, DishRecord>,
  orderedIds: ReadonlyArray<bigint>,
  summaryRelations: {
    readonly namesByDish: ReadonlyMap<string, Array<DishNameRow>>;
    readonly placesByDish: ReadonlyMap<string, Array<DishPlaceRow>>;
    readonly placeNamesByPlace: ReadonlyMap<string, Array<PlaceNameRow>>;
    readonly categorySlugsByDish: ReadonlyMap<string, Array<string>>;
  },
  locale: string,
): Array<DishSummary> => {
  const items: Array<DishSummary> = [];

  for (const id of orderedIds) {
    const key = id.toString();
    const record = records.get(key);

    if (record === undefined) {
      continue;
    }

    const names = summaryRelations.namesByDish.get(key) ?? [];
    const display = displayNameOf(names, locale);
    const dishPlaces = summaryRelations.placesByDish.get(key) ?? [];
    const regionNames: Array<string> = [];

    for (const place of dishPlaces) {
      const labels = summaryRelations.placeNamesByPlace.get(place.place_id.toString()) ?? [];
      const picked = pickDisplayName(labels.map(asLocalizedName), locale);

      if (picked !== undefined && !regionNames.includes(picked.name)) {
        regionNames.push(picked.name);
      }
    }

    items.push({
      id: encodeDbId(record.id),
      slug: record.slug,
      name: display.name,
      englishName: englishNameOf(names),
      regionNames,
      categorySlugs: summaryRelations.categorySlugsByDish.get(key) ?? [],
      updatedAt: record.updatedAt,
      lastUpdate: unixSeconds(record.updatedAt),
    });
  }

  return items;
};

export const DishServiceLive = Layer.effect(
  DishService,
  Effect.gen(function* () {
    const dishes = yield* DishRepository;
    const relations = yield* DishRelationsRepository;
    const ingredients = yield* IngredientRepository;
    const places = yield* PlaceRepository;
    const taxonomy = yield* TaxonomyRepository;

    const fetchSummaryRelations = (
      ids: ReadonlyArray<bigint>,
    ): Effect.Effect<
      {
        readonly namesByDish: ReadonlyMap<string, Array<DishNameRow>>;
        readonly placesByDish: ReadonlyMap<string, Array<DishPlaceRow>>;
        readonly placeNamesByPlace: ReadonlyMap<string, Array<PlaceNameRow>>;
        readonly categorySlugsByDish: ReadonlyMap<string, Array<string>>;
      },
      DatabaseError,
      Database
    > =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          const empty = new Map<string, Array<never>>();

          return {
            namesByDish: empty,
            placesByDish: empty,
            placeNamesByPlace: empty,
            categorySlugsByDish: new Map<string, Array<string>>(),
          };
        }

        const [names, dishPlaces, categories] = yield* Effect.all(
          [
            relations.namesByDishIds(ids),
            relations.placesByDishIds(ids),
            relations.categoriesByDishIds(ids),
          ],
          { concurrency: 3 },
        );

        const placeIds = [...new Set(dishPlaces.map((entry) => entry.place_id))];

        const placeNames = placeIds.length === 0 ? [] : yield* places.namesByPlaceIds(placeIds);

        const slugsByDish = new Map<string, Array<string>>();

        for (const entry of categories) {
          const key = entry.dish_id.toString();
          const existing = slugsByDish.get(key);

          if (existing === undefined) {
            slugsByDish.set(key, [entry.slug]);
          } else if (!existing.includes(entry.slug)) {
            existing.push(entry.slug);
          }
        }

        return {
          namesByDish: groupByDish(names, (row) => row.dish_id),
          placesByDish: groupByDish(dishPlaces, (row) => row.dish_id),
          placeNamesByPlace: groupByDish(placeNames, (row) => row.place_id),
          categorySlugsByDish: slugsByDish,
        };
      });

    const recordsByIds = (
      ids: ReadonlyArray<bigint>,
    ): Effect.Effect<ReadonlyMap<string, DishRecord>, DatabaseError, Database> =>
      Effect.gen(function* () {
        const records = new Map<string, DishRecord>();

        if (ids.length === 0) {
          return records;
        }

        const rows = yield* dishes.recordsByIds(ids);

        for (const row of rows) {
          records.set(row.id.toString(), row);
        }

        return records;
      });

    const resolveRecord = (idOrSlug: string) =>
      Effect.gen(function* () {
        if (isDbIdString(idOrSlug)) {
          const record = yield* dishes.findById(BigInt(idOrSlug));

          if (record === null || record.status !== "published") {
            return yield* new DishNotFound({ dishId: idOrSlug });
          }

          return record;
        }

        if (!isSlug(idOrSlug)) {
          return yield* new DishNotFound({ dishId: idOrSlug });
        }

        const record = yield* dishes.findBySlug(idOrSlug);

        if (record === null || record.status !== "published") {
          return yield* new DishNotFound({ dishId: idOrSlug });
        }

        return record;
      });

    const getDish = (
      idOrSlug: string,
      locale: string,
    ): Effect.Effect<DishProfile, DishServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);
        const record = yield* resolveRecord(idOrSlug);
        const dishId = record.id;

        const [names, descriptions, dishIngredients, dishPlaces, categories, cuisines, sources] =
          yield* Effect.all(
            [
              relations.namesByDishIds([dishId]),
              relations.descriptionsByDishIds([dishId]),
              relations.ingredientsByDishIds([dishId]),
              relations.placesByDishIds([dishId]),
              relations.categoriesByDishIds([dishId]),
              relations.cuisinesByDishIds([dishId]),
              relations.sourcesByDishIds([dishId]),
            ],
            { concurrency: 4 },
          );

        const ingredientIds = [...new Set(dishIngredients.map((entry) => entry.ingredient_id))];
        const placeIds = [...new Set(dishPlaces.map((entry) => entry.place_id))];

        const [ingredientNames, placeNames, allCategories, allCuisines] = yield* Effect.all(
          [
            ingredients.namesByIngredientIds(ingredientIds),
            places.namesByPlaceIds(placeIds),
            taxonomy.categories(),
            taxonomy.cuisines(),
          ],
          { concurrency: 4 },
        );

        const categoryNameById = new Map<string, string>();

        for (const row of allCategories) {
          if (row.language_tag === checkedLocale) {
            categoryNameById.set(row.id.toString(), row.name);
          }
        }

        for (const row of allCategories) {
          const key = row.id.toString();

          if (row.language_tag === "en" && !categoryNameById.has(key)) {
            categoryNameById.set(key, row.name);
          }
        }

        const cuisineNameById = new Map<string, string>();

        for (const row of allCuisines) {
          if (row.language_tag === checkedLocale) {
            cuisineNameById.set(row.id.toString(), row.name);
          }
        }

        for (const row of allCuisines) {
          const key = row.id.toString();

          if (row.language_tag === "en" && !cuisineNameById.has(key)) {
            cuisineNameById.set(key, row.name);
          }
        }

        const namesByIngredient = groupByDish(ingredientNames, (row) => row.ingredient_id);
        const namesByPlace = new Map<string, Array<PlaceNameRow>>();

        for (const name of placeNames) {
          const key = name.place_id.toString();
          const existing = namesByPlace.get(key);

          if (existing === undefined) {
            namesByPlace.set(key, [name]);
          } else {
            existing.push(name);
          }
        }

        const display = displayNameOf(names, checkedLocale);

        const description =
          descriptions.find((entry) => entry.language_tag === checkedLocale) ??
          descriptions.find((entry) => entry.language_tag === "en") ??
          descriptions[0];

        let parent: DishProfile["parent"] = null;

        if (record.parentDishId !== null) {
          const parentRecord = yield* dishes.findById(record.parentDishId);

          if (parentRecord !== null && parentRecord.status === "published") {
            parent = { id: encodeDbId(parentRecord.id), slug: parentRecord.slug };
          }
        }

        const profile: DishProfile = {
          id: encodeDbId(record.id),
          slug: record.slug,
          name: display.name,
          englishName: englishNameOf(names),
          nativeNames: names
            .filter((entry) => entry.name_kind === "native")
            .map((entry) => ({ languageTag: entry.language_tag, name: entry.name })),
          description: description?.description ?? description?.summary ?? null,
          descriptionLanguage: description?.language_tag ?? null,
          status: record.status,
          parent,
          ingredients: dishIngredients.map((entry) => {
            const labels = namesByIngredient.get(entry.ingredient_id.toString()) ?? [];

            return {
              id: encodeDbId(entry.ingredient_id),
              name: pickDisplayName(labels.map(asLocalizedName), checkedLocale)?.name,
              role: entry.role,
            };
          }),
          places: dishPlaces.map((entry) => {
            const labels = namesByPlace.get(entry.place_id.toString()) ?? [];

            return {
              id: encodeDbId(entry.place_id),
              name: pickDisplayName(labels.map(asLocalizedName), checkedLocale)?.name,
              association: entry.association,
              isDisputed: entry.is_disputed,
              kind: entry.kind,
              iso3166: entry.iso3166,
              displayLatitude: entry.display_latitude,
              displayLongitude: entry.display_longitude,
            };
          }),
          cuisines: cuisines.map((entry) => ({
            id: encodeDbId(entry.cuisine_id),
            slug: entry.slug,
            name: cuisineNameById.get(entry.cuisine_id.toString()),
          })),
          categories: categories.map((entry) => ({
            id: encodeDbId(entry.category_id),
            kind: entry.kind,
            slug: entry.slug,
            name: categoryNameById.get(entry.category_id.toString()),
          })),
          sources: sources.map((entry) => ({
            recordId: encodeDbId(entry.record_id),
            provider: entry.provider,
            externalId: entry.external_id,
            canonicalUrl: entry.canonical_url,
            license: entry.license,
            attribution: entry.attribution,
          })),
          lastUpdate: unixSeconds(record.updatedAt),
        };

        return profile;
      });

    const resolvePlaceFilter = (
      country: string | undefined,
      region: string | undefined,
      placeId: string | undefined,
    ): Effect.Effect<ReadonlyArray<bigint> | null, DishServiceError, Database> =>
      Effect.gen(function* () {
        if (country !== undefined) {
          if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(country)) {
            return yield* new InvalidSearchFilter({ reason: "country must be an ISO 3166 code" });
          }

          const place = yield* places.findByIso(country);

          if (place === null) {
            return yield* new PlaceNotFound({ placeId: country });
          }

          return yield* places.descendantIds(place.id);
        }

        if (region !== undefined) {
          if (!isDbIdString(region)) {
            return yield* new InvalidSearchFilter({ reason: "region must be a decimal id" });
          }

          const place = yield* places.findById(BigInt(region));

          if (place === null) {
            return yield* new PlaceNotFound({ placeId: region });
          }

          return yield* places.descendantIds(place.id);
        }

        if (placeId !== undefined) {
          if (!isDbIdString(placeId)) {
            return yield* new InvalidSearchFilter({ reason: "place must be a decimal id" });
          }

          const place = yield* places.findById(BigInt(placeId));

          if (place === null) {
            return yield* new PlaceNotFound({ placeId });
          }

          return yield* places.descendantIds(place.id);
        }

        return null;
      });

    const searchDishes = (
      input: SearchDishesInput,
    ): Effect.Effect<SearchDishesOutput, DishServiceError, Database> =>
      Effect.gen(function* () {
        const locale = yield* checkLocale(input.locale ?? "en");
        const limit = clampLimit(input.limit, DEFAULT_LIMIT);

        const ingredientIds = (input.ingredientIds ?? []).filter((value) => isDbIdString(value));

        if (
          input.ingredientIds !== undefined &&
          ingredientIds.length !== input.ingredientIds.length
        ) {
          return yield* new InvalidSearchFilter({
            reason: "ingredient ids must be decimal id strings",
          });
        }

        if (
          input.ingredientMode !== undefined &&
          input.ingredientMode !== "any" &&
          input.ingredientMode !== "all"
        ) {
          return yield* new InvalidSearchFilter({
            reason: "ingredient_mode must be any or all",
          });
        }

        if (
          input.categoryMode !== undefined &&
          input.categoryMode !== "any" &&
          input.categoryMode !== "all"
        ) {
          return yield* new InvalidSearchFilter({
            reason: "category_mode must be any or all",
          });
        }

        if (
          input.association !== undefined &&
          input.association !== "origin" &&
          input.association !== "associated" &&
          input.association !== "popular"
        ) {
          return yield* new InvalidSearchFilter({
            reason: "association must be origin, associated or popular",
          });
        }

        if (input.sort !== undefined && input.sort !== "relevance" && input.sort !== "recent") {
          return yield* new InvalidSearchFilter({ reason: "sort must be relevance or recent" });
        }

        const trimmedQuery = input.q?.trim() ?? "";

        if (trimmedQuery.length > 0) {
          if (!isSearchableQuery(trimmedQuery)) {
            return yield* new InvalidSearchFilter({ reason: "q is too long" });
          }

          const key = normalizeSearchKey(trimmedQuery);

          if (key.length === 0) {
            return yield* new InvalidSearchFilter({ reason: "q has no searchable text" });
          }

          if (input.sort === "recent") {
            const cursor = decodeBrowseCursor(input.cursor);

            if (input.cursor !== undefined && cursor === null) {
              return yield* new InvalidSearchFilter({ reason: "cursor is invalid" });
            }

            const ids = yield* dishes.searchRecentIds({
              q: key,
              prefix: toPrefixKey(key),
              contains: toContainsKey(key),
              status: "published",
              updated: cursor?.updated ?? FAR_FUTURE,
              cursor: BigInt(cursor?.id ?? "0"),
              limit: limit + 1,
            });

            const page = ids.slice(0, limit);
            const records = yield* recordsByIds(page);
            const summaryRelations = yield* fetchSummaryRelations(page);
            const items = toSummaries(records, page, summaryRelations, locale);

            const lastId = page.length > 0 ? page[page.length - 1] : undefined;
            const lastRecord = lastId === undefined ? undefined : records.get(lastId.toString());

            const nextCursor =
              ids.length > limit && lastRecord !== undefined
                ? encodeCursor({ updated: lastRecord.updatedAt, id: lastRecord.id.toString() })
                : null;

            return { items, nextCursor };
          }

          const cursor = decodeSearchCursor(input.cursor);

          if (input.cursor !== undefined && cursor === null) {
            return yield* new InvalidSearchFilter({ reason: "cursor is invalid" });
          }

          const rows = yield* dishes.searchIds({
            q: key,
            prefix: toPrefixKey(key),
            contains: toContainsKey(key),
            status: "published",
            tier: cursor?.tier ?? -1,
            cursor: BigInt(cursor?.id ?? "0"),
            limit: limit + 1,
          });

          const page = rows.slice(0, limit);
          const ids = page.map((row) => row.id);
          const records = yield* recordsByIds(ids);
          const summaryRelations = yield* fetchSummaryRelations(ids);
          const items = toSummaries(records, ids, summaryRelations, locale);
          const last = page[page.length - 1];

          const nextCursor =
            rows.length > limit && last !== undefined
              ? encodeCursor({ tier: last.tier, id: last.id.toString() })
              : null;

          return { items, nextCursor };
        }

        const categorySlugs = input.categorySlugs ?? [];

        const categoryRows =
          categorySlugs.length === 0 ? [] : yield* taxonomy.categoriesBySlugs(categorySlugs);

        if (categoryRows.length !== categorySlugs.length) {
          return yield* new InvalidSearchFilter({ reason: "unknown category slug" });
        }

        const placeIds = yield* resolvePlaceFilter(input.country, input.region, input.placeId);

        const hasFilters =
          ingredientIds.length > 0 ||
          categoryRows.length > 0 ||
          (placeIds !== null && placeIds.length > 0) ||
          input.cuisine !== undefined;

        if (input.cuisine !== undefined) {
          const cuisine = yield* taxonomy.cuisineBySlug(input.cuisine);

          if (cuisine === null) {
            return yield* new InvalidSearchFilter({ reason: "unknown cuisine slug" });
          }
        }

        if (hasFilters) {
          const cursor = decodeFilterCursor(input.cursor);

          if (input.cursor !== undefined && cursor === null) {
            return yield* new InvalidSearchFilter({ reason: "cursor is invalid" });
          }

          const ids = yield* relations.filterIds({
            ingredientIds: ingredientIds.map((value) => BigInt(value)),
            categoryIds: categoryRows.map((row) => row.id),
            placeIds: placeIds ?? [],
            ingredientMode: input.ingredientMode ?? "any",
            categoryMode: input.categoryMode ?? "any",
            cuisine: input.cuisine ?? null,
            association: input.association ?? null,
            status: "published",
            cursor: BigInt(cursor?.id ?? "0"),
            limit: limit + 1,
          });

          const page = ids.slice(0, limit);
          const records = yield* recordsByIds(page);
          const summaryRelations = yield* fetchSummaryRelations(page);
          const items = toSummaries(records, page, summaryRelations, locale);
          const last = page[page.length - 1];

          const nextCursor =
            ids.length > limit && last !== undefined ? encodeCursor({ id: last.toString() }) : null;

          return { items, nextCursor };
        }

        const cursor = decodeBrowseCursor(input.cursor);

        if (input.cursor !== undefined && cursor === null) {
          return yield* new InvalidSearchFilter({ reason: "cursor is invalid" });
        }

        const ids = yield* dishes.browseIds({
          status: "published",
          updated: cursor?.updated ?? FAR_FUTURE,
          cursor: BigInt(cursor?.id ?? "0"),
          limit: limit + 1,
        });

        const page = ids.slice(0, limit);
        const records = yield* recordsByIds(page);
        const summaryRelations = yield* fetchSummaryRelations(page);
        const items = toSummaries(records, page, summaryRelations, locale);

        const lastId = page.length > 0 ? page[page.length - 1] : undefined;
        const lastRecord = lastId === undefined ? undefined : records.get(lastId.toString());

        const nextCursor =
          ids.length > limit && lastRecord !== undefined
            ? encodeCursor({ updated: lastRecord.updatedAt, id: lastRecord.id.toString() })
            : null;

        return { items, nextCursor };
      });

    const getRelated = (
      idOrSlug: string,
      locale: string,
      limit: number | undefined,
    ): Effect.Effect<ReadonlyArray<DishSummary>, DishServiceError, Database> =>
      Effect.gen(function* () {
        const checkedLocale = yield* checkLocale(locale);
        const record = yield* resolveRecord(idOrSlug);
        const rows = yield* dishes.relatedIds(record.id, "published", clampLimit(limit, 8));
        const ids = rows.map((row) => row.id);
        const records = yield* recordsByIds(ids);
        const summaryRelations = yield* fetchSummaryRelations(ids);

        return toSummaries(records, ids, summaryRelations, checkedLocale);
      });

    return DishService.of({ getDish, searchDishes, getRelated });
  }),
);
