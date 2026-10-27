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
import { currentSql, isConnectionFailure } from "@/server/database/client";
import type { Database } from "@/server/database/client";
import { DatabaseUnavailable, PersistenceError } from "@/server/database/errors";

export type RevisionRow = (typeof revisionsByDishId)["~reylo"]["element"];

export type NoteRow = (typeof notesByDishId)["~reylo"]["element"];

export type ImportJobRow = (typeof importJobFindById)["~reylo"]["element"];

export type ImportRecordRow = (typeof importRecordsByJob)["~reylo"]["element"];

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

export class CurationRepository extends Context.Service<
  CurationRepository,
  {
    readonly insertRevision: (input: {
      readonly dishId: bigint;
      readonly actor: string;
      readonly operation: string;
      readonly summary: string;
    }) => Effect.Effect<RevisionRow, DatabaseUnavailable | PersistenceError, Database>;
    readonly revisionsByDishId: (
      dishId: bigint,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<RevisionRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
    readonly insertNote: (input: {
      readonly dishId: bigint;
      readonly author: string;
      readonly noteKind: string;
      readonly note: string;
    }) => Effect.Effect<NoteRow, DatabaseUnavailable | PersistenceError, Database>;
    readonly notesByDishId: (
      dishId: bigint,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<NoteRow>, DatabaseUnavailable | PersistenceError, Database>;
    readonly insertImportJob: (input: {
      readonly sourceName: string;
      readonly format: string;
      readonly status: string;
      readonly totalRecords: number;
      readonly validRecords: number;
      readonly invalidRecords: number;
      readonly dryRun: boolean;
    }) => Effect.Effect<ImportJobRow, DatabaseUnavailable | PersistenceError, Database>;
    readonly updateImportJob: (input: {
      readonly id: bigint;
      readonly status: string;
      readonly validRecords: number;
      readonly invalidRecords: number;
      readonly completedAt: string | null;
    }) => Effect.Effect<ImportJobRow | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly findImportJob: (
      id: bigint,
    ) => Effect.Effect<ImportJobRow | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly insertImportRecord: (input: {
      readonly jobId: bigint;
      readonly externalRef: string;
      readonly status: string;
      readonly errors: string | null;
      readonly dishId: bigint | null;
      readonly payload: StoredImportRecord;
    }) => Effect.Effect<ImportRecordRow, DatabaseUnavailable | PersistenceError, Database>;
    readonly updateImportRecord: (input: {
      readonly id: bigint;
      readonly status: string;
      readonly errors: string | null;
      readonly dishId: bigint | null;
    }) => Effect.Effect<ImportRecordRow | null, DatabaseUnavailable | PersistenceError, Database>;
    readonly recordsByJobId: (
      jobId: bigint,
      limit: number,
    ) => Effect.Effect<
      ReadonlyArray<ImportRecordRow>,
      DatabaseUnavailable | PersistenceError,
      Database
    >;
  }
>()("feastjourney/food-discovery/CurationRepository") {}

export const CurationRepositoryLive = Layer.succeed(CurationRepository, {
  insertRevision: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          revisionInsert.run(sql, {
            dish_id: input.dishId,
            actor: input.actor,
            operation: input.operation,
            summary: input.summary,
          }),
        catch: (cause) => readFailure("curation/revision-insert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "curation/revision-insert",
          cause: "insert returned no row",
        });
      }

      return first;
    }),
  revisionsByDishId: (dishId, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => revisionsByDishId.run(sql, { dish_id: dishId, limit }),
        catch: (cause) => readFailure("curation/revisions-by-dish", cause),
      });

      return toArray(rows);
    }),
  insertNote: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          noteInsert.run(sql, {
            dish_id: input.dishId,
            author: input.author,
            note_kind: input.noteKind,
            note: input.note,
          }),
        catch: (cause) => readFailure("curation/note-insert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "curation/note-insert",
          cause: "insert returned no row",
        });
      }

      return first;
    }),
  notesByDishId: (dishId, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => notesByDishId.run(sql, { dish_id: dishId, limit }),
        catch: (cause) => readFailure("curation/notes-by-dish", cause),
      });

      return toArray(rows);
    }),
  insertImportJob: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          importJobInsert.run(sql, {
            source_name: input.sourceName,
            format: input.format,
            status: input.status,
            total_records: input.totalRecords,
            valid_records: input.validRecords,
            invalid_records: input.invalidRecords,
            dry_run: input.dryRun,
          }),
        catch: (cause) => readFailure("curation/import-job-insert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "curation/import-job-insert",
          cause: "insert returned no row",
        });
      }

      return first;
    }),
  updateImportJob: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          importJobUpdate.run(sql, {
            id: input.id,
            status: input.status,
            valid_records: input.validRecords,
            invalid_records: input.invalidRecords,
            completed_at: input.completedAt,
          }),
        catch: (cause) => readFailure("curation/import-job-update", cause),
      });

      return toArray(row)[0] ?? null;
    }),
  findImportJob: (id) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () => importJobFindById.run(sql, { id }),
        catch: (cause) => readFailure("curation/import-job-find", cause),
      });

      return toArray(row)[0] ?? null;
    }),
  insertImportRecord: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          importRecordInsert.run(sql, {
            job_id: input.jobId,
            external_ref: input.externalRef,
            status: input.status,
            errors: input.errors,
            dish_id: input.dishId,
            payload: input.payload,
          }),
        catch: (cause) => readFailure("curation/import-record-insert", cause),
      });

      const created = toArray(row);
      const first = created[0];

      if (first === undefined) {
        return yield* new PersistenceError({
          operation: "curation/import-record-insert",
          cause: "insert returned no row",
        });
      }

      return first;
    }),
  updateImportRecord: (input) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const row = yield* Effect.tryPromise({
        try: () =>
          importRecordUpdate.run(sql, {
            id: input.id,
            status: input.status,
            errors: input.errors,
            dish_id: input.dishId,
          }),
        catch: (cause) => readFailure("curation/import-record-update", cause),
      });

      return toArray(row)[0] ?? null;
    }),
  recordsByJobId: (jobId, limit) =>
    Effect.gen(function* () {
      const sql = yield* currentSql;

      const rows = yield* Effect.tryPromise({
        try: () => importRecordsByJob.run(sql, { job_id: jobId, limit }),
        catch: (cause) => readFailure("curation/import-records-by-job", cause),
      });

      return toArray(rows);
    }),
});
