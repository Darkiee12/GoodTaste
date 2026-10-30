import { Context, Effect, Layer } from "effect";

import { type DishNotFound, InvalidDishData } from "@/modules/food-discovery/server/domain/errors";
import { isDbIdString } from "@/modules/food-discovery/server/domain/ids";
import {
  CurationService,
  type CurationServiceError,
} from "@/modules/food-discovery/server/operations/curation-service";
import type { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import bulkPublishStatusUpdate from "@/modules/food-discovery/server/repository/sql/bulk-publish-status-update.sql";
import bulkReviewCandidates from "@/modules/food-discovery/server/repository/sql/bulk-review-candidates.sql";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import type { TransactionFailed } from "@/server/database/errors";
import { type DatabaseError, runQuery } from "@/server/database/query";

/**
 * Bulk editorial review and publishing. Imports land dishes in `review`;
 * the public carousel stays published-only. This service pages review
 * candidates with metadata/provenance flags and publishes explicit batches.
 *
 * Transport (proposed `adminBulk*` server functions, owned by the
 * coordinator) enforces `food:publish` against current database grants at
 * the server boundary; this service performs no additional policy beyond
 * the per-call editorial/license acks and the per-dish publication
 * checklist. Mechanical validation is never editorial approval: a dish that
 * fails the checklist lands in `failed` with reasons, never published.
 */
export const MAX_BULK_PUBLISH_IDS = 50;

export const MAX_BULK_REVIEW_CANDIDATES = 100;

export type BulkReviewCandidateRow = (typeof bulkReviewCandidates)["~reylo"]["element"];

export interface BulkReviewCandidate {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly displayName: string | null;
  readonly importJobId: string | null;
  readonly importSourceName: string | null;
  readonly importLicense: string | null;
  readonly importLicenseAck: boolean;
  readonly importReviewAck: boolean;
  readonly hasEnglishName: boolean;
  readonly hasDescription: boolean;
  readonly ingredientCount: number;
  readonly categoryCount: number;
  readonly placeCount: number;
  readonly sourceCount: number;
  readonly noteCount: number;
  readonly openQuestionCount: number;
  readonly licenseNeedsReview: boolean;
}

export interface BulkPublishAcks {
  readonly editorialAck: boolean;
  readonly licenseAck: boolean;
}

export interface BulkPublishedRecord {
  readonly id: string;
  readonly slug: string;
}

export interface BulkSkippedRecord {
  readonly id: string;
  readonly reason: string;
}

export interface BulkFailedRecord {
  readonly id: string;
  readonly reasons: ReadonlyArray<string>;
}

export interface BulkPublishReport {
  readonly published: ReadonlyArray<BulkPublishedRecord>;
  readonly skipped: ReadonlyArray<BulkSkippedRecord>;
  readonly failed: ReadonlyArray<BulkFailedRecord>;
}

export interface BulkReviewCandidatesInput {
  readonly cursor: bigint;
  readonly limit: number;
  readonly jobId: bigint | null;
}

export interface BulkPublishBatchInput {
  readonly actor: string;
  readonly ids: ReadonlyArray<string>;
  readonly acks: BulkPublishAcks;
}

export interface BulkPublishJobInput {
  readonly actor: string;
  readonly jobId: string;
  readonly cursor: bigint;
  readonly limit: number;
  readonly acks: BulkPublishAcks;
}

export interface BulkPublishJobReport {
  readonly jobId: string;
  readonly report: BulkPublishReport;
  readonly nextCursor: string | null;
}

export type BulkPublishServiceError =
  | DishNotFound
  | InvalidDishData
  | CurationServiceError
  | DatabaseError
  | TransactionFailed;

const toCandidate = (row: BulkReviewCandidateRow): BulkReviewCandidate => ({
  id: row.id,
  slug: row.slug,
  status: row.status,
  displayName: row.display_name,
  importJobId: row.import_job_id,
  importSourceName: row.import_source_name,
  importLicense: row.import_license,
  importLicenseAck: row.import_license_ack ?? false,
  importReviewAck: row.import_review_ack ?? false,
  hasEnglishName: row.has_english_name,
  hasDescription: row.has_description,
  ingredientCount: row.ingredient_count,
  categoryCount: row.category_count,
  placeCount: row.place_count,
  sourceCount: row.source_count,
  noteCount: row.note_count,
  openQuestionCount: row.open_question_count,
  licenseNeedsReview: row.license_needs_review,
});

const checkAcks = (acks: BulkPublishAcks): Effect.Effect<void, InvalidDishData> => {
  if (!acks.editorialAck || !acks.licenseAck) {
    return Effect.fail(
      new InvalidDishData({
        reason:
          "bulk publish requires explicit editorial and license review confirmation for this batch",
      }),
    );
  }

  return Effect.void;
};

export class BulkPublishService extends Context.Service<
  BulkPublishService,
  {
    readonly listReviewCandidates: (
      input: BulkReviewCandidatesInput,
    ) => Effect.Effect<ReadonlyArray<BulkReviewCandidate>, DatabaseError, Database>;
    readonly publishBatch: (
      input: BulkPublishBatchInput,
    ) => Effect.Effect<BulkPublishReport, BulkPublishServiceError, Database | CurationRepository>;
    readonly publishImportJobBatch: (
      input: BulkPublishJobInput,
    ) => Effect.Effect<
      BulkPublishJobReport,
      BulkPublishServiceError,
      Database | CurationRepository
    >;
  }
>()("feastjourney/food-discovery/BulkPublishService") {}

const listReviewCandidates = (
  input: BulkReviewCandidatesInput,
): Effect.Effect<ReadonlyArray<BulkReviewCandidate>, DatabaseError, Database> =>
  Effect.gen(function* () {
    if (input.limit < 1 || input.limit > MAX_BULK_REVIEW_CANDIDATES) {
      return [];
    }

    const rows = yield* runQuery("bulk-publish/review-candidates", (sql) =>
      bulkReviewCandidates.run(sql, {
        cursor: input.cursor,
        job_id: input.jobId,
        limit: input.limit,
      }),
    );

    return rows.map(toCandidate);
  });

export const BulkPublishServiceLive = Layer.effect(
  BulkPublishService,
  Effect.gen(function* () {
    const curation = yield* CurationService;

    const publishBatch = (
      input: BulkPublishBatchInput,
    ): Effect.Effect<BulkPublishReport, BulkPublishServiceError, Database | CurationRepository> =>
      Effect.gen(function* () {
        yield* checkAcks(input.acks);

        if (input.ids.length === 0) {
          return yield* new InvalidDishData({ reason: "at least one dish id is required" });
        }

        if (input.ids.length > MAX_BULK_PUBLISH_IDS) {
          return yield* new InvalidDishData({
            reason: `at most ${MAX_BULK_PUBLISH_IDS} dishes per bulk publish call`,
          });
        }

        const published: Array<BulkPublishedRecord> = [];
        const skipped: Array<BulkSkippedRecord> = [];
        const failed: Array<BulkFailedRecord> = [];
        const readyIds: Array<bigint> = [];
        const seen = new Set<string>();

        for (const id of input.ids) {
          if (seen.has(id)) {
            skipped.push({ id, reason: "duplicate dish id in request" });
            continue;
          }

          seen.add(id);

          if (!isDbIdString(id)) {
            skipped.push({ id, reason: "dish id must be a decimal id string" });
            continue;
          }

          const dishId = BigInt(id);

          const ready = yield* curation.validatePublication(dishId).pipe(
            Effect.map((result): bigint | null => {
              if (!result.publishable) {
                failed.push({ id, reasons: result.reasons });

                return null;
              }

              return dishId;
            }),
            Effect.catchTag("DishNotFound", () => {
              skipped.push({ id, reason: "dish not found" });

              return Effect.succeed(null);
            }),
            Effect.catch(() => {
              failed.push({
                id,
                reasons: ["dish could not be validated; safe to retry this batch"],
              });

              return Effect.succeed(null);
            }),
          );

          if (ready !== null) {
            readyIds.push(ready);
          }
        }

        if (readyIds.length > 0) {
          const applied = yield* withTransaction(
            "bulk-publish/apply-batch",
            Effect.gen(function* () {
              const rows = yield* runQuery("bulk-publish/status-update", (sql) =>
                bulkPublishStatusUpdate.run(sql, { ids: readyIds }),
              );

              for (const row of rows) {
                yield* curation.recordRevision(
                  BigInt(row.id),
                  input.actor,
                  "status_changed",
                  "bulk publish review -> published",
                );
              }

              return rows;
            }),
          ).pipe(Effect.catch(() => Effect.succeed(null)));

          if (applied === null) {
            for (const dishId of readyIds) {
              failed.push({
                id: dishId.toString(),
                reasons: [
                  "publish transaction failed; nothing in this batch was applied; safe to retry",
                ],
              });
            }

            return { published, skipped, failed };
          }

          const appliedIds = new Set(applied.map((row) => row.id));

          for (const row of applied) {
            published.push({ id: row.id, slug: row.slug });
          }

          for (const dishId of readyIds) {
            if (!appliedIds.has(dishId.toString())) {
              skipped.push({
                id: dishId.toString(),
                reason:
                  "dish is no longer awaiting review (already published, moved, or removed); safe to ignore on retry",
              });
            }
          }
        }

        return { published, skipped, failed };
      });

    const publishImportJobBatch = (
      input: BulkPublishJobInput,
    ): Effect.Effect<
      BulkPublishJobReport,
      BulkPublishServiceError,
      Database | CurationRepository
    > =>
      Effect.gen(function* () {
        if (!isDbIdString(input.jobId)) {
          return yield* new InvalidDishData({ reason: "job id must be a decimal id string" });
        }

        const limit = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_BULK_PUBLISH_IDS);
        const jobId = BigInt(input.jobId);
        const candidates = yield* listReviewCandidates({ cursor: input.cursor, limit, jobId });

        if (candidates.length === 0) {
          return {
            jobId: input.jobId,
            report: { published: [], skipped: [], failed: [] },
            nextCursor: null,
          };
        }

        const report = yield* publishBatch({
          actor: input.actor,
          ids: candidates.map((candidate) => candidate.id),
          acks: input.acks,
        });

        const last = candidates[candidates.length - 1];
        const nextCursor = candidates.length >= limit && last !== undefined ? last.id : null;

        return { jobId: input.jobId, report, nextCursor };
      });

    return BulkPublishService.of({
      listReviewCandidates,
      publishBatch,
      publishImportJobBatch,
    });
  }),
);
