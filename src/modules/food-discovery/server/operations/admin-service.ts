import { Context, Effect, Layer } from "effect";

import {
  type CatalogConflict,
  ConflictingDish,
  DishNotFound,
  InvalidDishData,
  InvalidLocale,
  InvalidSearchFilter,
} from "@/modules/food-discovery/server/domain/errors";
import {
  encodeDbId,
  isDbIdString,
  isLanguageTag,
  isSlug,
  slugifyName,
} from "@/modules/food-discovery/server/domain/ids";
import { normalizeSearchKey } from "@/modules/food-discovery/server/domain/search";
import { CurationService } from "@/modules/food-discovery/server/operations/curation-service";
import { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import { DishRepository } from "@/modules/food-discovery/server/repository/dish-repository";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import { PlaceRepository } from "@/modules/food-discovery/server/repository/place-repository";
import { TaxonomyRepository } from "@/modules/food-discovery/server/repository/taxonomy-repository";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import {
  type DatabaseUnavailable,
  type PersistenceConflict,
  type PersistenceError,
  type TransactionFailed,
} from "@/server/database/errors";

const STATUSES: ReadonlySet<string> = new Set(["draft", "review", "published", "archived"]);

const NAME_KINDS: ReadonlySet<string> = new Set([
  "native",
  "localized",
  "alias",
  "transliteration",
]);

const ROLES: ReadonlySet<string> = new Set(["core", "common", "optional", "garnish"]);
const ASSOCIATIONS: ReadonlySet<string> = new Set(["origin", "associated", "popular"]);
const MAX_SLUG_ATTEMPTS = 20;

export type AdminServiceError =
  | CatalogConflict
  | ConflictingDish
  | DishNotFound
  | InvalidDishData
  | InvalidLocale
  | InvalidSearchFilter
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionFailed;

export interface CreateDishNameInput {
  readonly languageTag: string;
  readonly name: string;
  readonly nameKind: string;
}

export interface CreateDishInput {
  readonly slug?: string | undefined;
  readonly status?: string | undefined;
  readonly parentSlug?: string | undefined;
  readonly names: ReadonlyArray<CreateDishNameInput>;
}

export interface UpdateDishInput {
  readonly slug?: string | undefined;
  readonly status?: string | undefined;
  readonly parentSlug?: string | undefined;
}

export class AdminService extends Context.Service<
  AdminService,
  {
    readonly createDish: (
      actor: string,
      input: CreateDishInput,
    ) => Effect.Effect<{ readonly id: string; readonly slug: string }, AdminServiceError, Database>;
    readonly updateDish: (
      actor: string,
      id: string,
      input: UpdateDishInput,
    ) => Effect.Effect<{ readonly id: string; readonly slug: string }, AdminServiceError, Database>;
    readonly updateDishStatus: (
      actor: string,
      id: string,
      status: string,
    ) => Effect.Effect<
      { readonly id: string; readonly status: string },
      AdminServiceError,
      Database
    >;
    readonly addDishName: (
      actor: string,
      dishId: string,
      input: CreateDishNameInput,
    ) => Effect.Effect<{ readonly name: string }, AdminServiceError, Database>;
    readonly upsertDishDescription: (
      actor: string,
      dishId: string,
      languageTag: string,
      description: string,
      summary: string | null,
    ) => Effect.Effect<void, AdminServiceError, Database>;
    readonly linkDishIngredient: (
      actor: string,
      dishId: string,
      ingredientId: string,
      role: string,
    ) => Effect.Effect<void, AdminServiceError, Database>;
    readonly linkDishPlace: (
      actor: string,
      dishId: string,
      placeId: string,
      association: string,
      isDisputed: boolean,
    ) => Effect.Effect<void, AdminServiceError, Database>;
    readonly linkDishCategory: (
      actor: string,
      dishId: string,
      categorySlug: string,
    ) => Effect.Effect<void, AdminServiceError, Database>;
    readonly linkDishCuisine: (
      actor: string,
      dishId: string,
      cuisineSlug: string,
    ) => Effect.Effect<void, AdminServiceError, Database>;
  }
>()("feastjourney/food-discovery/AdminService") {}

const checkDishId = (id: string): Effect.Effect<bigint, InvalidSearchFilter> =>
  isDbIdString(id)
    ? Effect.succeed(BigInt(id))
    : Effect.fail(new InvalidSearchFilter({ reason: "dish id must be a decimal id string" }));

const checkStatus = (status: string): Effect.Effect<string, InvalidSearchFilter> =>
  STATUSES.has(status)
    ? Effect.succeed(status)
    : Effect.fail(new InvalidSearchFilter({ reason: "unknown dish status" }));

const checkNameKind = (kind: string): Effect.Effect<string, InvalidSearchFilter> =>
  NAME_KINDS.has(kind)
    ? Effect.succeed(kind)
    : Effect.fail(new InvalidSearchFilter({ reason: "unknown name kind" }));

const checkSlug = (slug: string): Effect.Effect<string, InvalidDishData> =>
  isSlug(slug) && slug.length <= 120
    ? Effect.succeed(slug)
    : Effect.fail(new InvalidDishData({ reason: `invalid slug "${slug}"` }));

const preparedNames = (names: ReadonlyArray<CreateDishNameInput>) =>
  Effect.gen(function* () {
    if (names.length === 0) {
      return yield* new InvalidSearchFilter({ reason: "at least one name is required" });
    }

    const prepared: Array<{
      readonly languageTag: string;
      readonly name: string;
      readonly nameKind: string;
      readonly searchKey: string;
    }> = [];

    const seen = new Set<string>();

    for (const entry of names) {
      if (!isLanguageTag(entry.languageTag)) {
        return yield* new InvalidLocale({ locale: entry.languageTag });
      }

      yield* checkNameKind(entry.nameKind);

      const trimmed = entry.name.trim();

      if (trimmed.length === 0 || trimmed.length > 300) {
        return yield* new InvalidSearchFilter({ reason: "name must be 1-300 characters" });
      }

      const key = normalizeSearchKey(trimmed);

      if (key.length === 0) {
        return yield* new InvalidSearchFilter({ reason: "name has no searchable text" });
      }

      const dedupe = `${entry.languageTag} ${trimmed}`;

      if (seen.has(dedupe)) {
        return yield* new InvalidSearchFilter({ reason: "duplicate name in request" });
      }

      seen.add(dedupe);
      prepared.push({
        languageTag: entry.languageTag,
        name: trimmed,
        nameKind: entry.nameKind,
        searchKey: key,
      });
    }

    return prepared;
  });

export const AdminServiceLive = Layer.effect(
  AdminService,
  Effect.gen(function* () {
    const dishes = yield* DishRepository;
    const relations = yield* DishRelationsRepository;
    const ingredientRepository = yield* IngredientRepository;
    const placeRepository = yield* PlaceRepository;
    const taxonomy = yield* TaxonomyRepository;
    const curation = yield* CurationService;

    const requireDish = (id: bigint) =>
      Effect.gen(function* () {
        const record = yield* dishes.findById(id);

        if (record === null) {
          return yield* new DishNotFound({ dishId: id.toString() });
        }

        return record;
      });

    const uniqueSlug = (base: string, ignoreId?: bigint) =>
      Effect.gen(function* () {
        const taken = yield* dishes.findBySlug(base);

        if (taken === null || (ignoreId !== undefined && taken.id === ignoreId)) {
          return base;
        }

        for (let attempt = 2; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
          const candidate = `${base}-${attempt}`;
          const clash = yield* dishes.findBySlug(candidate);

          if (clash === null || (ignoreId !== undefined && clash.id === ignoreId)) {
            return candidate;
          }
        }

        return yield* new ConflictingDish({
          reason: `could not allocate a unique slug for "${base}"`,
        });
      });

    const resolveParent = (parentSlug: string | undefined) =>
      Effect.gen(function* () {
        if (parentSlug === undefined) {
          return null;
        }

        const checked = yield* checkSlug(parentSlug);
        const parent = yield* dishes.findBySlug(checked);

        if (parent === null) {
          return yield* new InvalidSearchFilter({
            reason: `unknown parent slug "${parentSlug}"`,
          });
        }

        return parent.id;
      });

    const createDish = (actor: string, input: CreateDishInput) =>
      Effect.gen(function* () {
        const status = yield* checkStatus(input.status ?? "draft");
        const names = yield* preparedNames(input.names);
        const parentDishId = yield* resolveParent(input.parentSlug);

        const baseSlug =
          input.slug !== undefined
            ? yield* checkSlug(input.slug)
            : slugifyName(names[0]?.name ?? "dish");

        const created = yield* withTransaction(
          "admin/create-dish",
          Effect.gen(function* () {
            const slug = yield* uniqueSlug(baseSlug);
            const record = yield* dishes.insert({ slug, parentDishId, status });
            const preferredByLocale = new Map<string, boolean>();

            for (const entry of names) {
              const isPreferred = !preferredByLocale.has(entry.languageTag);
              preferredByLocale.set(entry.languageTag, true);

              yield* relations.insertName({
                dishId: record.id,
                languageTag: entry.languageTag,
                name: entry.name,
                nameKind: entry.nameKind,
                isPreferred,
                searchKey: entry.searchKey,
              });
            }

            yield* curation.recordRevision(
              record.id,
              actor,
              "created",
              `created dish ${record.slug}`,
            );

            return record;
          }),
        ).pipe(
          Effect.catchTag("PersistenceConflict", (failure) =>
            Effect.fail(
              new ConflictingDish({
                reason: `slug conflict (${failure.constraint ?? "unique constraint"})`,
              }),
            ),
          ),
        );

        return { id: encodeDbId(created.id), slug: created.slug };
      });

    const updateDish = (actor: string, id: string, input: UpdateDishInput) =>
      Effect.gen(function* () {
        const dishId = yield* checkDishId(id);
        const record = yield* requireDish(dishId);
        const slug = input.slug !== undefined ? yield* checkSlug(input.slug) : record.slug;

        const status =
          input.status !== undefined ? yield* checkStatus(input.status) : record.status;

        const parentDishId =
          input.parentSlug !== undefined
            ? yield* resolveParent(input.parentSlug)
            : record.parentDishId;

        if (parentDishId !== null && parentDishId === record.id) {
          return yield* new InvalidDishData({ reason: "a dish cannot be its own parent" });
        }

        if (status === "published" && record.status !== "published") {
          const check = yield* curation.validatePublication(record.id);

          if (!check.publishable) {
            return yield* new InvalidDishData({
              reason: `publication blocked: ${check.reasons.join("; ")}`,
            });
          }
        }

        const updated = yield* withTransaction(
          "admin/update-dish",
          Effect.gen(function* () {
            const result = yield* dishes.update({
              id: record.id,
              slug,
              parentDishId,
              status,
            });

            if (result === null) {
              return yield* new DishNotFound({ dishId: id });
            }

            if (status !== record.status) {
              yield* curation.recordRevision(
                record.id,
                actor,
                "status_changed",
                `status ${record.status} -> ${status}`,
              );
            }

            return result;
          }),
        ).pipe(
          Effect.catchTag("PersistenceConflict", (failure) =>
            Effect.fail(
              new ConflictingDish({
                reason: `slug conflict (${failure.constraint ?? "unique constraint"})`,
              }),
            ),
          ),
        );

        return { id: encodeDbId(updated.id), slug: updated.slug };
      });

    const updateDishStatus = (actor: string, id: string, status: string) =>
      Effect.gen(function* () {
        const updated = yield* updateDish(actor, id, { status });

        return { id: updated.id, status };
      });

    const addDishName = (actor: string, dishId: string, input: CreateDishNameInput) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);

        if (!isLanguageTag(input.languageTag)) {
          return yield* new InvalidLocale({ locale: input.languageTag });
        }

        yield* checkNameKind(input.nameKind);

        const trimmed = input.name.trim();

        if (trimmed.length === 0 || trimmed.length > 300) {
          return yield* new InvalidSearchFilter({ reason: "name must be 1-300 characters" });
        }

        const key = normalizeSearchKey(trimmed);

        if (key.length === 0) {
          return yield* new InvalidSearchFilter({ reason: "name has no searchable text" });
        }

        const created = yield* withTransaction(
          "admin/add-dish-name",
          Effect.gen(function* () {
            const existing = yield* relations.namesByDishIds([id]);

            const preferredExists = existing.some(
              (entry) => entry.language_tag === input.languageTag && entry.is_preferred,
            );

            const row = yield* relations.insertName({
              dishId: id,
              languageTag: input.languageTag,
              name: trimmed,
              nameKind: input.nameKind,
              isPreferred: !preferredExists,
              searchKey: key,
            });

            yield* curation.recordRevision(
              id,
              actor,
              "name_added",
              `added ${input.languageTag} name "${trimmed}"`,
            );

            return row;
          }),
        ).pipe(
          Effect.catchTag("PersistenceConflict", (failure) =>
            Effect.fail(
              new ConflictingDish({
                reason: `name conflict (${failure.constraint ?? "unique constraint"})`,
              }),
            ),
          ),
        );

        return { name: created.name };
      });

    const upsertDishDescription = (
      actor: string,
      dishId: string,
      languageTag: string,
      description: string,
      summary: string | null,
    ) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);

        if (!isLanguageTag(languageTag)) {
          return yield* new InvalidLocale({ locale: languageTag });
        }

        if (description.trim().length === 0 || description.length > 20000) {
          return yield* new InvalidSearchFilter({
            reason: "description must be 1-20000 characters",
          });
        }

        if (summary !== null && (summary.trim().length === 0 || summary.length > 1000)) {
          return yield* new InvalidSearchFilter({
            reason: "summary must be 1-1000 characters",
          });
        }

        return yield* withTransaction(
          "admin/upsert-description",
          Effect.gen(function* () {
            yield* relations.upsertDescription({ dishId: id, languageTag, description, summary });
            yield* curation.recordRevision(
              id,
              actor,
              "description_updated",
              `updated ${languageTag} description`,
            );
          }),
        );
      });

    const linkDishIngredient = (
      actor: string,
      dishId: string,
      ingredientId: string,
      role: string,
    ) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);

        if (!isDbIdString(ingredientId)) {
          return yield* new InvalidSearchFilter({ reason: "ingredient id must be decimal" });
        }

        if (!ROLES.has(role)) {
          return yield* new InvalidSearchFilter({ reason: "unknown ingredient role" });
        }

        const ingredient = yield* ingredientRepository.findById(BigInt(ingredientId));

        if (ingredient === null) {
          return yield* new InvalidSearchFilter({ reason: "unknown ingredient id" });
        }

        return yield* withTransaction(
          "admin/link-ingredient",
          Effect.gen(function* () {
            yield* relations.linkIngredient(id, ingredient.id, role);
            yield* curation.recordRevision(
              id,
              actor,
              "ingredient_linked",
              `linked ingredient ${ingredient.id.toString()} (${role})`,
            );
          }),
        );
      });

    const linkDishPlace = (
      actor: string,
      dishId: string,
      placeId: string,
      association: string,
      isDisputed: boolean,
    ) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);

        if (!isDbIdString(placeId)) {
          return yield* new InvalidSearchFilter({ reason: "place id must be decimal" });
        }

        if (!ASSOCIATIONS.has(association)) {
          return yield* new InvalidSearchFilter({ reason: "unknown place association" });
        }

        const place = yield* placeRepository.findById(BigInt(placeId));

        if (place === null) {
          return yield* new InvalidSearchFilter({ reason: "unknown place id" });
        }

        return yield* withTransaction(
          "admin/link-place",
          Effect.gen(function* () {
            yield* relations.linkPlace({
              dishId: id,
              placeId: place.id,
              association,
              isDisputed,
              note: null,
            });
            yield* curation.recordRevision(
              id,
              actor,
              "place_linked",
              `linked place ${place.id.toString()} (${association})`,
            );
          }),
        );
      });

    const linkDishCategory = (actor: string, dishId: string, categorySlug: string) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);
        const rows = yield* taxonomy.categoriesBySlugs([categorySlug]);
        const category = rows[0];

        if (category === undefined) {
          return yield* new InvalidSearchFilter({ reason: "unknown category slug" });
        }

        return yield* withTransaction(
          "admin/link-category",
          Effect.gen(function* () {
            yield* relations.linkCategory(id, category.id);
            yield* curation.recordRevision(
              id,
              actor,
              "category_linked",
              `linked category ${category.slug}`,
            );
          }),
        );
      });

    const linkDishCuisine = (actor: string, dishId: string, cuisineSlug: string) =>
      Effect.gen(function* () {
        const id = yield* checkDishId(dishId);
        yield* requireDish(id);
        const cuisine = yield* taxonomy.cuisineBySlug(cuisineSlug);

        if (cuisine === null) {
          return yield* new InvalidSearchFilter({ reason: "unknown cuisine slug" });
        }

        return yield* withTransaction(
          "admin/link-cuisine",
          Effect.gen(function* () {
            yield* relations.linkCuisine(id, cuisine.id);
            yield* curation.recordRevision(
              id,
              actor,
              "cuisine_linked",
              `linked cuisine ${cuisine.slug}`,
            );
          }),
        );
      });

    return AdminService.of({
      createDish,
      updateDish,
      updateDishStatus,
      addDishName,
      upsertDishDescription,
      linkDishIngredient,
      linkDishPlace,
      linkDishCategory,
      linkDishCuisine,
    });
  }),
);
