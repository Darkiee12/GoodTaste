import { Context, Effect, Layer, Option, Schema } from "effect";

import { needsLicenseReview } from "@/modules/food-discovery/admin.schema";
import {
  CatalogConflict,
  DishNotFound,
  InvalidDishData,
  InvalidRelationship,
} from "@/modules/food-discovery/server/domain/errors";
import { encodeDbId, isDbIdString, slugifyName } from "@/modules/food-discovery/server/domain/ids";
import { ImportPayload, StoredImportRecord } from "@/modules/food-discovery/server/domain/schemas";
import type { AuthoringDish } from "@/modules/food-discovery/server/domain/schemas";
import {
  isSearchableQuery,
  normalizeSearchKey,
} from "@/modules/food-discovery/server/domain/search";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import { DishRepository } from "@/modules/food-discovery/server/repository/dish-repository";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import { PlaceRepository } from "@/modules/food-discovery/server/repository/place-repository";
import {
  SourceRepository,
  TaxonomyRepository,
} from "@/modules/food-discovery/server/repository/taxonomy-repository";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import type {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
  TransactionConflict,
  TransactionFailed,
} from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";

export type CatalogImportError =
  | CatalogConflict
  | DishNotFound
  | InvalidDishData
  | InvalidRelationship
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionConflict
  | TransactionFailed;

export interface ImportValidationItem {
  readonly externalRef: string;
  readonly status: "valid" | "invalid";
  readonly errors: ReadonlyArray<string>;
  readonly duplicateOf: string | null;
  readonly slug: string | null;
}

export interface ImportValidationReport {
  readonly jobId: string;
  readonly totalRecords: number;
  readonly validRecords: number;
  readonly invalidRecords: number;
  readonly items: ReadonlyArray<ImportValidationItem>;
}

export interface ImportApplyReport {
  readonly jobId: string;
  readonly applied: number;
  readonly skippedDuplicate: number;
  readonly failed: number;
}

export interface ImportValidateInput {
  readonly sourceName: string;
  readonly payload: unknown;
  readonly format?: "json" | "csv";
  readonly sourceUrl?: string | null;
  readonly sourceVersion?: string | null;
  readonly license?: string | null;
  readonly attribution?: string | null;
  readonly editorialNotes?: string | null;
}

export interface ImportApplyApprovals {
  readonly licenseAck: boolean;
  readonly reviewAck: boolean;
  readonly duplicateRefs: ReadonlyArray<string>;
}

export interface ImportApplyInput {
  readonly jobId: string;
  readonly approvals: ImportApplyApprovals;
  readonly actorUserId: string;
}

export class CatalogImportService extends Context.Service<
  CatalogImportService,
  {
    readonly validateImport: (
      input: ImportValidateInput,
    ) => Effect.Effect<ImportValidationReport, CatalogImportError, Database>;
    readonly applyImport: (
      input: ImportApplyInput,
    ) => Effect.Effect<ImportApplyReport, CatalogImportError, Database>;
  }
>()("feastjourney/food-discovery/CatalogImportService") {}

const MAX_SLUG_ATTEMPTS = 20;

export const CatalogImportServiceLive = Layer.effect(
  CatalogImportService,
  Effect.gen(function* () {
    const dishes = yield* DishRepository;
    const relations = yield* DishRelationsRepository;
    const ingredientRepository = yield* IngredientRepository;
    const placeRepository = yield* PlaceRepository;
    const taxonomy = yield* TaxonomyRepository;
    const sources = yield* SourceRepository;
    const curation = yield* CurationRepository;

    const uniqueSlug = (base: string): Effect.Effect<string, DatabaseError, Database> =>
      Effect.gen(function* () {
        if ((yield* dishes.findBySlug(base)) === null) {
          return base;
        }

        for (let attempt = 2; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
          const candidate = `${base}-${attempt}`;

          if ((yield* dishes.findBySlug(candidate)) === null) {
            return candidate;
          }
        }

        return `${base}-${Date.now().toString(36)}`;
      });

    const resolveIngredients = (record: AuthoringDish) =>
      Effect.gen(function* () {
        const resolved: Array<{ readonly id: bigint; readonly role: string }> = [];
        const errors: Array<string> = [];

        for (const ingredient of record.ingredients ?? []) {
          const key = normalizeSearchKey(ingredient.name);

          if (key.length === 0) {
            errors.push(`ingredient "${ingredient.name}" has no searchable text`);

            continue;
          }

          const candidates = yield* ingredientRepository.resolveByKey(
            key,
            ingredient.language_tag ?? "en",
            1,
          );

          const match = candidates[0];

          if (match === undefined) {
            errors.push(`unknown ingredient "${ingredient.name}"`);

            continue;
          }

          resolved.push({ id: match.ingredientId, role: ingredient.role });
        }

        return { resolved, errors };
      });

    const resolvePlaces = (record: AuthoringDish) =>
      Effect.gen(function* () {
        const resolved: Array<{ readonly id: bigint; readonly association: string }> = [];
        const errors: Array<string> = [];

        for (const place of record.places ?? []) {
          if (place.iso !== undefined) {
            const found = yield* placeRepository.findByIso(place.iso);

            if (found === null) {
              errors.push(`unknown place iso "${place.iso}"`);

              continue;
            }

            resolved.push({ id: found.id, association: place.association });

            continue;
          }

          if (place.place_id !== undefined) {
            if (!isDbIdString(place.place_id)) {
              errors.push(`invalid place id "${place.place_id}"`);

              continue;
            }

            const found = yield* placeRepository.findById(BigInt(place.place_id));

            if (found === null) {
              errors.push(`unknown place id "${place.place_id}"`);

              continue;
            }

            resolved.push({ id: found.id, association: place.association });

            continue;
          }

          errors.push("place entries require iso or placeId");
        }

        return { resolved, errors };
      });

    const findDuplicateSlug = (
      record: AuthoringDish,
      placeIds: ReadonlyArray<bigint>,
      cuisineSlugs: ReadonlyArray<string>,
    ): Effect.Effect<string | null, DatabaseError, Database> =>
      Effect.gen(function* () {
        for (const name of record.names) {
          if (!isSearchableQuery(name.name)) {
            continue;
          }

          const key = normalizeSearchKey(name.name);

          if (key.length === 0) {
            continue;
          }

          const dishIds = yield* dishes.resolveByNameKey(key, 5);

          for (const dishId of dishIds) {
            const candidate = yield* dishes.findById(dishId);

            if (candidate === null) {
              continue;
            }

            const [candidatePlaces, candidateCuisines] = yield* Effect.all(
              [relations.placesByDishIds([dishId]), relations.cuisinesByDishIds([dishId])],
              { concurrency: 2 },
            );

            const placeOverlap = candidatePlaces.some((entry) => placeIds.includes(entry.place_id));

            const cuisineOverlap =
              cuisineSlugs.length === 0 ||
              candidateCuisines.some((entry) => cuisineSlugs.includes(entry.slug));

            if (placeOverlap && cuisineOverlap) {
              return candidate.slug;
            }
          }
        }

        return null;
      });

    const validateRecord = (
      record: AuthoringDish,
      index: number,
    ): Effect.Effect<
      {
        readonly externalRef: string;
        readonly errors: Array<string>;
        readonly slug: string | null;
        readonly duplicateOf: string | null;
      },
      DatabaseError,
      Database
    > =>
      Effect.gen(function* () {
        const errors: Array<string> = [];
        const externalRef = record.slug ?? `record-${index + 1}`;

        if (record.slug !== undefined) {
          const taken = yield* dishes.findBySlug(record.slug);

          if (taken !== null) {
            errors.push(`slug "${record.slug}" already exists`);
          }
        }

        if (record.parent_slug !== undefined) {
          const parent = yield* dishes.findBySlug(record.parent_slug);

          if (parent === null) {
            errors.push(`unknown parent slug "${record.parent_slug}"`);
          }
        }

        const { errors: ingredientErrors } = yield* resolveIngredients(record);

        const { resolved: placeIds, errors: placeErrors } = yield* resolvePlaces(record);

        errors.push(...ingredientErrors, ...placeErrors);

        const cuisineSlugs = [...new Set(record.cuisines ?? [])];

        for (const slug of cuisineSlugs) {
          if ((yield* taxonomy.cuisineBySlug(slug)) === null) {
            errors.push(`unknown cuisine "${slug}"`);
          }
        }

        const categorySlugs = [...new Set(record.categories ?? [])];

        if (categorySlugs.length > 0) {
          const found = yield* taxonomy.categoriesBySlugs(categorySlugs);

          if (found.length !== categorySlugs.length) {
            errors.push("one or more categories are unknown");
          }
        }

        const duplicateOf =
          errors.length === 0
            ? yield* findDuplicateSlug(
                record,
                placeIds.map((entry) => entry.id),
                cuisineSlugs,
              )
            : null;

        return { externalRef, errors, slug: record.slug ?? null, duplicateOf };
      });

    const validateImport = (input: ImportValidateInput) =>
      Effect.gen(function* () {
        const trimmedSource = input.sourceName.trim().slice(0, 200);

        if (trimmedSource.length === 0) {
          return yield* new InvalidDishData({ reason: "source name is required" });
        }

        const decoded = yield* Option.match(
          Schema.decodeUnknownOption(ImportPayload)(input.payload),
          {
            onNone: () => Effect.fail(new InvalidDishData({ reason: "invalid import payload" })),
            onSome: (value) => Effect.succeed(value),
          },
        );

        const seenSlugs = new Map<string, string>();

        for (const [index, record] of decoded.records.entries()) {
          if (record.slug === undefined || record.slug.length === 0) {
            continue;
          }

          const externalRef = record.slug;
          const first = seenSlugs.get(record.slug);

          if (first !== undefined) {
            return yield* new InvalidDishData({
              reason: `duplicate slug "${record.slug}" in records "${first}" and "${externalRef}" (record ${index + 1})`,
            });
          }

          seenSlugs.set(record.slug, externalRef);
        }

        return yield* withTransaction(
          "import/validate",
          Effect.gen(function* () {
            const job = yield* curation.insertImportJob({
              sourceName: trimmedSource,
              format: input.format ?? "json",
              status: "staged",
              totalRecords: decoded.records.length,
              validRecords: 0,
              invalidRecords: 0,
              dryRun: true,
              sourceUrl: input.sourceUrl ?? null,
              sourceVersion: input.sourceVersion ?? null,
              license: input.license ?? null,
              attribution: input.attribution ?? null,
              editorialNotes: input.editorialNotes ?? null,
            });

            const items: Array<ImportValidationItem> = [];
            let valid = 0;

            for (const [index, record] of decoded.records.entries()) {
              const checked = yield* validateRecord(record, index);
              const status = checked.errors.length === 0 ? "valid" : "invalid";

              if (status === "valid") {
                valid += 1;
              }

              yield* curation.insertImportRecord({
                jobId: job.id,
                externalRef: checked.externalRef,
                status,
                errors: checked.errors.length === 0 ? null : JSON.stringify(checked.errors),
                dishId: null,
                payload: { record, duplicateOf: checked.duplicateOf },
              });

              items.push({
                externalRef: checked.externalRef,
                status,
                errors: checked.errors,
                duplicateOf: checked.duplicateOf,
                slug: checked.slug,
              });
            }

            const invalid = decoded.records.length - valid;

            yield* curation.updateImportJob({
              id: job.id,
              status: valid > 0 ? "validated" : "failed",
              validRecords: valid,
              invalidRecords: invalid,
              completedAt: new Date().toISOString(),
            });

            return {
              jobId: encodeDbId(job.id),
              totalRecords: decoded.records.length,
              validRecords: valid,
              invalidRecords: invalid,
              items,
            };
          }),
        );
      });

    interface ApplyJobProvenance {
      readonly id: bigint;
      readonly sourceName: string;
      readonly sourceUrl: string | null;
      readonly sourceVersion: string | null;
      readonly license: string | null;
      readonly attribution: string | null;
    }

    const providerSlugForJob = (job: ApplyJobProvenance): string | null => {
      const licenseRaw = job.license ?? "";
      const separator = licenseRaw.indexOf(":");

      if (separator > 0) {
        const sourceId = licenseRaw.slice(0, separator).trim().toLowerCase();

        if (sourceId.length > 0) {
          return sourceId;
        }
      }

      return slugifyName(job.sourceName);
    };

    const applyRecord = (
      job: ApplyJobProvenance,
      recordRowId: bigint,
      externalRef: string,
      record: AuthoringDish,
      duplicateOf: string | null,
    ): Effect.Effect<{ readonly applied: boolean }, CatalogImportError, Database> =>
      withTransaction(
        `import/${job.id.toString()}`,
        Effect.gen(function* () {
          const baseSlug = record.slug ?? slugifyName(record.names[0].name);
          const slug = yield* uniqueSlug(baseSlug);
          let parentId: bigint | null = null;

          if (record.parent_slug !== undefined) {
            const parent = yield* dishes.findBySlug(record.parent_slug);

            if (parent === null) {
              return yield* new InvalidRelationship({
                reason: `unknown parent slug "${record.parent_slug}"`,
              });
            }

            parentId = parent.id;
          }

          const existing = yield* dishes.findBySlug(slug);

          if (existing !== null) {
            yield* curation.updateImportRecord({
              id: recordRowId,
              status: "skipped_duplicate",
              errors: JSON.stringify([`slug "${slug}" already exists`]),
              dishId: existing.id,
            });

            return { applied: false };
          }

          const created = yield* dishes.insert({
            slug,
            parentDishId: parentId,
            status: "review",
          });

          yield* curation.insertRevision({
            dishId: created.id,
            actor: `import:${job.id.toString()}`,
            operation: "created",
            summary: `bulk import from staged record ${slug}`,
          });

          const providerSlug = providerSlugForJob(job);

          if (providerSlug !== null) {
            const provider = yield* sources.providerBySlug(providerSlug);

            if (provider !== null) {
              const stored = yield* sources.upsertRecord({
                providerId: provider.id,
                externalId: externalRef,
                canonicalUrl: job.sourceUrl,
                retrievedAt: new Date().toISOString(),
                revision: job.sourceVersion,
                license: job.license,
                attribution: job.attribution,
                importStatus: "imported",
                payload: JSON.stringify(record),
              });

              yield* relations.linkDishSource(created.id, stored.id);
            }
          }

          const preferredByLocale = new Set<string>();

          for (const name of record.names) {
            const isPreferred = !preferredByLocale.has(name.language_tag);
            preferredByLocale.add(name.language_tag);

            yield* relations
              .insertName({
                dishId: created.id,
                languageTag: name.language_tag,
                name: name.name,
                nameKind: name.name_kind,
                isPreferred,
                searchKey: normalizeSearchKey(name.name),
              })
              .pipe(Effect.catchTag("PersistenceConflict", () => Effect.void));
          }

          for (const description of record.descriptions ?? []) {
            yield* relations.upsertDescription({
              dishId: created.id,
              languageTag: description.language_tag,
              description: description.description,
              summary: description.summary,
            });
          }

          for (const ingredient of record.ingredients ?? []) {
            const key = normalizeSearchKey(ingredient.name);

            const candidates = yield* ingredientRepository.resolveByKey(
              key,
              ingredient.language_tag ?? "en",
              1,
            );

            const match = candidates[0];

            if (match === undefined) {
              return yield* new InvalidRelationship({
                reason: `unknown ingredient "${ingredient.name}"`,
              });
            }

            yield* relations.linkIngredient(created.id, match.ingredientId, ingredient.role);
            yield* curation.insertRevision({
              dishId: created.id,
              actor: `import:${job.id.toString()}`,
              operation: "ingredient_linked",
              summary: `linked ingredient ${match.ingredientId.toString()} (${ingredient.role})`,
            });
          }

          for (const place of record.places ?? []) {
            if (place.iso !== undefined) {
              const found = yield* placeRepository.findByIso(place.iso);

              if (found === null) {
                return yield* new InvalidRelationship({
                  reason: `unknown place iso "${place.iso}"`,
                });
              }

              yield* relations.linkPlace({
                dishId: created.id,
                placeId: found.id,
                association: place.association,
                isDisputed: false,
                note: place.note ?? null,
              });
            } else if (place.place_id !== undefined && isDbIdString(place.place_id)) {
              const found = yield* placeRepository.findById(BigInt(place.place_id));

              if (found === null) {
                return yield* new InvalidRelationship({
                  reason: `unknown place id "${place.place_id}"`,
                });
              }

              yield* relations.linkPlace({
                dishId: created.id,
                placeId: found.id,
                association: place.association,
                isDisputed: false,
                note: place.note ?? null,
              });
            } else {
              return yield* new InvalidRelationship({
                reason: "place entries require iso or placeId",
              });
            }

            yield* curation.insertRevision({
              dishId: created.id,
              actor: `import:${job.id.toString()}`,
              operation: "place_linked",
              summary: `linked place (${place.association})`,
            });
          }

          const cuisineSlugs = new Set(record.cuisines ?? []);

          for (const cuisineSlug of cuisineSlugs) {
            const cuisine = yield* taxonomy.cuisineBySlug(cuisineSlug);

            if (cuisine === null) {
              return yield* new InvalidRelationship({ reason: `unknown cuisine "${cuisineSlug}"` });
            }

            yield* relations.linkCuisine(created.id, cuisine.id);
            yield* curation.insertRevision({
              dishId: created.id,
              actor: `import:${job.id.toString()}`,
              operation: "cuisine_linked",
              summary: `linked cuisine ${cuisine.slug}`,
            });
          }

          const categorySlugs = [...new Set(record.categories ?? [])];

          if (categorySlugs.length > 0) {
            const categories = yield* taxonomy.categoriesBySlugs(categorySlugs);

            for (const category of categories) {
              yield* relations.linkCategory(created.id, category.id);
              yield* curation.insertRevision({
                dishId: created.id,
                actor: `import:${job.id.toString()}`,
                operation: "category_linked",
                summary: `linked category ${category.slug}`,
              });
            }
          }

          if (duplicateOf !== null) {
            yield* curation.insertNote({
              dishId: created.id,
              author: `import:${job.id.toString()}`,
              noteKind: "review",
              note: `Possible duplicate of ${duplicateOf}; verify before publishing.`,
            });
          }

          if (record.editorial_note !== undefined) {
            yield* curation.insertNote({
              dishId: created.id,
              author: `import:${job.id.toString()}`,
              noteKind: "review",
              note: record.editorial_note,
            });
          }

          yield* curation.updateImportRecord({
            id: recordRowId,
            status: "applied",
            errors: null,
            dishId: created.id,
          });

          return { applied: true };
        }),
      );

    const applyImport = (input: ImportApplyInput) =>
      Effect.gen(function* () {
        if (!isDbIdString(input.jobId)) {
          return yield* new InvalidDishData({ reason: "job id must be a decimal id string" });
        }

        const actor = input.actorUserId.trim();

        if (actor.length === 0) {
          return yield* new InvalidDishData({ reason: "approving actor is required" });
        }

        const job = yield* curation.findImportJobForApply(BigInt(input.jobId));

        if (job === null) {
          return yield* new DishNotFound({ dishId: input.jobId });
        }

        if (job.status !== "validated") {
          return yield* new CatalogConflict({
            reason: `import job ${input.jobId} is ${job.status}, only validated jobs can be applied`,
          });
        }

        const licenseRaw = job.license ?? "";
        const separator = licenseRaw.indexOf(":");
        const sourceId = separator === -1 ? "" : licenseRaw.slice(0, separator);
        const licensePart = separator === -1 ? licenseRaw : licenseRaw.slice(separator + 1);
        const reviewRequired = licenseRaw.length === 0 || needsLicenseReview(sourceId, licensePart);

        if (reviewRequired && !input.approvals.licenseAck) {
          return yield* new InvalidDishData({
            reason: "license review acknowledgement is required before applying this import",
          });
        }

        if (!input.approvals.reviewAck) {
          return yield* new InvalidDishData({
            reason: "review acknowledgement is required before applying this import",
          });
        }

        const rows = yield* curation.recordsByJobId(job.id, 1000);
        const acknowledged = new Set(input.approvals.duplicateRefs);

        const pending: Array<{
          readonly rowId: bigint;
          readonly externalRef: string;
          readonly record: AuthoringDish;
          readonly duplicateOf: string | null;
        }> = [];

        for (const row of rows) {
          if (row.status !== "valid") {
            continue;
          }

          const raw: unknown = JSON.parse(row.payload);

          const stored = yield* Option.match(Schema.decodeUnknownOption(StoredImportRecord)(raw), {
            onNone: () =>
              Effect.fail(new InvalidDishData({ reason: "stored import record is corrupt" })),
            onSome: (value) => Effect.succeed(value),
          });

          if (stored.duplicateOf !== null && !acknowledged.has(row.external_ref)) {
            return yield* new InvalidDishData({
              reason: `duplicate "${row.external_ref}" requires acknowledgement before apply`,
            });
          }

          pending.push({
            rowId: row.id,
            externalRef: row.external_ref,
            record: stored.record,
            duplicateOf: stored.duplicateOf,
          });
        }

        yield* curation.updateImportJob({
          id: job.id,
          status: job.status,
          validRecords: job.valid_records,
          invalidRecords: job.invalid_records,
          completedAt: job.completed_at,
          dryRun: false,
        });

        const provenance: ApplyJobProvenance = {
          id: job.id,
          sourceName: job.source_name,
          sourceUrl: job.source_url,
          sourceVersion: job.source_version,
          license: job.license,
          attribution: job.attribution,
        };

        let applied = 0;
        let skippedDuplicate = 0;
        let failed = 0;

        for (const entry of pending) {
          const outcome = yield* applyRecord(
            provenance,
            entry.rowId,
            entry.externalRef,
            entry.record,
            entry.duplicateOf,
          ).pipe(
            Effect.matchEffect({
              onFailure: () => Effect.succeed({ applied: false as const, skipped: false as const }),
              onSuccess: (result) =>
                Effect.succeed({ applied: result.applied, skipped: !result.applied }),
            }),
          );

          if (outcome.applied) {
            applied += 1;
          } else if (outcome.skipped) {
            skippedDuplicate += 1;
          } else {
            failed += 1;

            yield* curation.updateImportRecord({
              id: entry.rowId,
              status: "invalid",
              errors: JSON.stringify(["apply failed"]),
              dishId: null,
            });
          }
        }

        yield* curation.approveImportJob({
          id: job.id,
          approvedBy: actor,
          approvedAt: new Date().toISOString(),
          licenseAck: input.approvals.licenseAck,
          reviewAck: input.approvals.reviewAck,
          duplicateRefs: [...input.approvals.duplicateRefs],
        });

        yield* curation.updateImportJob({
          id: job.id,
          status: "applied",
          validRecords: applied,
          invalidRecords: failed + skippedDuplicate,
          completedAt: new Date().toISOString(),
        });

        return { jobId: input.jobId, applied, skippedDuplicate, failed };
      });

    return CatalogImportService.of({ validateImport, applyImport });
  }),
);
