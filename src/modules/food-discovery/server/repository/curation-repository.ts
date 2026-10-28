import { Context, Effect, Layer } from "effect";

import type { StoredImportRecord } from "@/modules/food-discovery/server/domain/schemas";
import adminImportJobFind from "@/modules/food-discovery/server/repository/sql/admin-import-job-find.sql";
import adminImportJobsByStatus from "@/modules/food-discovery/server/repository/sql/admin-import-jobs-by-status.sql";
import adminImportJobsRecent from "@/modules/food-discovery/server/repository/sql/admin-import-jobs-recent.sql";
import adminImportRecordsByJob from "@/modules/food-discovery/server/repository/sql/admin-import-records-by-job.sql";
import importJobApprove from "@/modules/food-discovery/server/repository/sql/import-job-approve.sql";
import importJobClaimForApply from "@/modules/food-discovery/server/repository/sql/import-job-claim-for-apply.sql";
import importJobFindById from "@/modules/food-discovery/server/repository/sql/import-job-find-by-id.sql";
import importJobFindWithSource from "@/modules/food-discovery/server/repository/sql/import-job-find-with-source.sql";
import importJobInsert from "@/modules/food-discovery/server/repository/sql/import-job-insert.sql";
import importJobLockForApply from "@/modules/food-discovery/server/repository/sql/import-job-lock-for-apply.sql";
import importJobUpdate from "@/modules/food-discovery/server/repository/sql/import-job-update.sql";
import importRecordInsert from "@/modules/food-discovery/server/repository/sql/import-record-insert.sql";
import importRecordUpdate from "@/modules/food-discovery/server/repository/sql/import-record-update.sql";
import importRecordsByJob from "@/modules/food-discovery/server/repository/sql/import-records-by-job.sql";
import noteInsert from "@/modules/food-discovery/server/repository/sql/note-insert.sql";
import notesByDishId from "@/modules/food-discovery/server/repository/sql/notes-by-dish-id.sql";
import revisionInsert from "@/modules/food-discovery/server/repository/sql/revision-insert.sql";
import revisionsByDishId from "@/modules/food-discovery/server/repository/sql/revisions-by-dish-id.sql";
import type { Database } from "@/server/database/client";
import { type DatabaseError, runQuery } from "@/server/database/query";

export type RevisionRow = (typeof revisionsByDishId)["~reylo"]["element"];

export type NoteRow = (typeof notesByDishId)["~reylo"]["element"];

export type ImportJobRow = (typeof importJobFindById)["~reylo"]["element"];

export type ImportJobApprovalRow = (typeof importJobApprove)["~reylo"]["element"];

export type ImportJobWithSourceRow = (typeof importJobFindWithSource)["~reylo"]["element"];

export type ImportRecordRow = (typeof importRecordsByJob)["~reylo"]["element"];

export type AdminImportJobRow = (typeof adminImportJobFind)["~reylo"]["element"];

export type AdminImportJobStatusRow = (typeof adminImportJobsByStatus)["~reylo"]["element"];

export type AdminImportJobRecentRow = (typeof adminImportJobsRecent)["~reylo"]["element"];

export type AdminImportRecordRow = (typeof adminImportRecordsByJob)["~reylo"]["element"];

export class CurationRepository extends Context.Service<
  CurationRepository,
  {
    readonly insertRevision: (input: {
      readonly dishId: bigint;
      readonly actor: string;
      readonly operation: string;
      readonly summary: string;
    }) => Effect.Effect<RevisionRow, DatabaseError, Database>;
    readonly revisionsByDishId: (
      dishId: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<RevisionRow>, DatabaseError, Database>;
    readonly insertNote: (input: {
      readonly dishId: bigint;
      readonly author: string;
      readonly noteKind: string;
      readonly note: string;
    }) => Effect.Effect<NoteRow, DatabaseError, Database>;
    readonly notesByDishId: (
      dishId: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<NoteRow>, DatabaseError, Database>;
    readonly insertImportJob: (input: {
      readonly sourceName: string;
      readonly format: string;
      readonly status: string;
      readonly totalRecords: number;
      readonly validRecords: number;
      readonly invalidRecords: number;
      readonly dryRun: boolean;
      readonly sourceUrl?: string | null;
      readonly sourceVersion?: string | null;
      readonly license?: string | null;
      readonly attribution?: string | null;
      readonly editorialNotes?: string | null;
    }) => Effect.Effect<ImportJobRow, DatabaseError, Database>;
    readonly updateImportJob: (input: {
      readonly id: bigint;
      readonly status: string;
      readonly validRecords: number;
      readonly invalidRecords: number;
      readonly completedAt: string | null;
      readonly dryRun?: boolean | undefined;
    }) => Effect.Effect<ImportJobRow | null, DatabaseError, Database>;
    readonly approveImportJob: (input: {
      readonly id: bigint;
      readonly approvedBy: string;
      readonly approvedAt: string;
      readonly licenseAck: boolean;
      readonly reviewAck: boolean;
      readonly duplicateRefs: ReadonlyArray<string>;
    }) => Effect.Effect<ImportJobApprovalRow | null, DatabaseError, Database>;
    readonly findImportJobForApply: (
      id: bigint,
    ) => Effect.Effect<ImportJobWithSourceRow | null, DatabaseError, Database>;
    readonly claimImportJobForApply: (
      id: bigint,
    ) => Effect.Effect<ImportJobWithSourceRow | null, DatabaseError, Database>;
    readonly lockImportJobForApply: (
      id: bigint,
    ) => Effect.Effect<ImportJobWithSourceRow | null, DatabaseError, Database>;
    readonly findImportJob: (
      id: bigint,
    ) => Effect.Effect<ImportJobRow | null, DatabaseError, Database>;
    readonly insertImportRecord: (input: {
      readonly jobId: bigint;
      readonly externalRef: string;
      readonly status: string;
      readonly errors: string | null;
      readonly dishId: bigint | null;
      readonly payload: StoredImportRecord;
    }) => Effect.Effect<ImportRecordRow, DatabaseError, Database>;
    readonly updateImportRecord: (input: {
      readonly id: bigint;
      readonly status: string;
      readonly errors: string | null;
      readonly dishId: bigint | null;
    }) => Effect.Effect<ImportRecordRow | null, DatabaseError, Database>;
    readonly recordsByJobId: (
      jobId: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<ImportRecordRow>, DatabaseError, Database>;
    readonly importJobsByStatus: () => Effect.Effect<
      ReadonlyArray<AdminImportJobStatusRow>,
      DatabaseError,
      Database
    >;
    readonly recentImportJobs: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminImportJobRecentRow>, DatabaseError, Database>;
    readonly adminFindImportJob: (
      id: bigint,
    ) => Effect.Effect<AdminImportJobRow | null, DatabaseError, Database>;
    readonly adminRecordsByJobId: (
      jobId: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminImportRecordRow>, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/CurationRepository") {}

export const CurationRepositoryLive = Layer.succeed(CurationRepository, {
  insertRevision: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/revision-insert", (sql) =>
        revisionInsert.run(sql, {
          dish_id: input.dishId,
          actor: input.actor,
          operation: input.operation,
          summary: input.summary,
        }),
      );
    }),
  revisionsByDishId: (dishId, limit) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/revisions-by-dish", (sql) =>
        revisionsByDishId.run(sql, { dish_id: dishId, limit }),
      );
    }),
  insertNote: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/note-insert", (sql) =>
        noteInsert.run(sql, {
          dish_id: input.dishId,
          author: input.author,
          note_kind: input.noteKind,
          note: input.note,
        }),
      );
    }),
  notesByDishId: (dishId, limit) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/notes-by-dish", (sql) =>
        notesByDishId.run(sql, { dish_id: dishId, limit }),
      );
    }),
  insertImportJob: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-insert", (sql) =>
        importJobInsert.run(sql, {
          source_name: input.sourceName,
          format: input.format,
          status: input.status,
          total_records: input.totalRecords,
          valid_records: input.validRecords,
          invalid_records: input.invalidRecords,
          dry_run: input.dryRun,
          source_url: input.sourceUrl ?? null,
          source_version: input.sourceVersion ?? null,
          license: input.license ?? null,
          attribution: input.attribution ?? null,
          editorial_notes: input.editorialNotes ?? null,
        }),
      );
    }),
  updateImportJob: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-update", (sql) =>
        importJobUpdate.run(sql, {
          id: input.id,
          status: input.status,
          valid_records: input.validRecords,
          invalid_records: input.invalidRecords,
          completed_at: input.completedAt,
          dry_run: input.dryRun ?? null,
        }),
      );
    }),
  approveImportJob: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-approve", (sql) =>
        importJobApprove.run(sql, {
          id: input.id,
          approved_by: input.approvedBy,
          approved_at: input.approvedAt,
          license_ack: input.licenseAck,
          review_ack: input.reviewAck,
          acknowledged_duplicates: [...input.duplicateRefs],
        }),
      );
    }),
  findImportJobForApply: (id) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-find-with-source", (sql) =>
        importJobFindWithSource.run(sql, { id }),
      );
    }),
  claimImportJobForApply: (id) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-claim-for-apply", (sql) =>
        importJobClaimForApply.run(sql, { id }),
      );
    }),
  lockImportJobForApply: (id) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-lock-for-apply", (sql) =>
        importJobLockForApply.run(sql, { id }),
      );
    }),
  findImportJob: (id) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-job-find", (sql) =>
        importJobFindById.run(sql, { id }),
      );
    }),
  insertImportRecord: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-record-insert", (sql) =>
        importRecordInsert.run(sql, {
          job_id: input.jobId,
          external_ref: input.externalRef,
          status: input.status,
          errors: input.errors,
          dish_id: input.dishId,
          payload: input.payload,
        }),
      );
    }),
  updateImportRecord: (input) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-record-update", (sql) =>
        importRecordUpdate.run(sql, {
          id: input.id,
          status: input.status,
          errors: input.errors,
          dish_id: input.dishId,
        }),
      );
    }),
  recordsByJobId: (jobId, limit) =>
    Effect.gen(function* () {
      return yield* runQuery("curation/import-records-by-job", (sql) =>
        importRecordsByJob.run(sql, { job_id: jobId, limit }),
      );
    }),
  importJobsByStatus: () =>
    runQuery("curation/import-jobs-by-status", (sql) => adminImportJobsByStatus.run(sql)),
  recentImportJobs: (limit) =>
    runQuery("curation/import-jobs-recent", (sql) => adminImportJobsRecent.run(sql, { limit })),
  adminFindImportJob: (id) =>
    runQuery("curation/import-job-find-admin", (sql) => adminImportJobFind.run(sql, { id })),
  adminRecordsByJobId: (jobId, limit) =>
    runQuery("curation/import-records-admin", (sql) =>
      adminImportRecordsByJob.run(sql, { job_id: jobId, limit }),
    ),
});
