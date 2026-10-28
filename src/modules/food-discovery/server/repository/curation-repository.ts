import { Context, Effect, Layer } from "effect";

import type { StoredImportRecord } from "@/modules/food-discovery/server/domain/schemas";
import importJobFindById from "@/modules/food-discovery/server/repository/sql/import-job-find-by-id.sql";
import importJobInsert from "@/modules/food-discovery/server/repository/sql/import-job-insert.sql";
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

export type ImportRecordRow = (typeof importRecordsByJob)["~reylo"]["element"];

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
    }) => Effect.Effect<ImportJobRow, DatabaseError, Database>;
    readonly updateImportJob: (input: {
      readonly id: bigint;
      readonly status: string;
      readonly validRecords: number;
      readonly invalidRecords: number;
      readonly completedAt: string | null;
    }) => Effect.Effect<ImportJobRow | null, DatabaseError, Database>;
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
        }),
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
});
