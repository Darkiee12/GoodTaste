// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import {
  MAX_BATCHED_IMPORT_RECORDS,
  MAX_IMPORT_RECORDS,
  csvToRecords,
  jsonToRecords,
} from "@/modules/food-discovery/admin.schema";
import { CatalogConflict, InvalidDishData } from "@/modules/food-discovery/server/domain/errors";
import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_STAGE_BATCH_SIZE,
  CatalogImportService,
} from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { requirePermission } from "@/server/auth/session";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./food-auth";

/**
 * Import batching coverage.
 *
 * Targets the SHIPPED contracts (re-read at test time). The first block
 * pins the single-shot path: the 100-record cap at every layer, duplicate
 * handling, and resume/race/RBAC semantics. The second block covers the
 * DURABLE BATCHING protocol as declared in `CatalogImportService`
 * (`beginImport` / `stageImportBatch` / `applyImportBatch` /
 * `importJobIssues`), backed by migration
 * V20261030_003__import_batching_progress: one logical job, bounded
 * batches, `staged_count` as the stage cursor, `(job_id, record_index)`
 * idempotency, global cross-batch slug scans, keyset-paginated issues.
 *
 * Isolation follows the import-suite pattern: unique stamps per file run,
 * no TRUNCATE, no seed-count coupling. Applied dishes stay in the disposable
 * test database exactly like the existing journey/atomicity suites.
 */

const foodAuth = createFoodAuth();

const compareIdText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

afterAll(() => foodAuth.close());

const stamp = Date.now().toString(36);
const ACTOR = `batching:test-approver-${stamp}`;
const MANUAL_LICENSE = "manual:manual-entry";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const query = async <T>(statement: (sql: SQL) => Promise<T>): Promise<T> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    return await statement(sql);
  } finally {
    await sql.end();
  }
};

interface MinimalRecord {
  readonly names: ReadonlyArray<{
    readonly language_tag: string;
    readonly name: string;
    readonly name_kind: string;
  }>;
  readonly categories: ReadonlyArray<string>;
  readonly slug?: string | undefined;
  readonly parent_slug?: string | undefined;
}

const minimalRecord = (tag: string, index: number, slug?: string): MinimalRecord => {
  const record: MinimalRecord = {
    names: [
      { language_tag: "en", name: `Batch ${tag} Dish ${index} ${stamp}`, name_kind: "localized" },
    ],
    categories: ["soup"],
  };

  return slug === undefined ? record : { ...record, slug };
};

const validateRecords = (
  sourceName: string,
  records: ReadonlyArray<unknown>,
  license = MANUAL_LICENSE,
) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.validateImport({
        sourceName,
        payload: { source_name: sourceName, records: [...records] },
        license,
      }),
    ),
  );

const applyJob = (jobId: string, duplicateRefs: ReadonlyArray<string> = []) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.applyImport({
        jobId,
        approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [...duplicateRefs] },
        actorUserId: ACTOR,
      }),
    ),
  );

const strandInApplying = (jobId: string, validRecords: number, invalidRecords: number) =>
  run(
    Effect.flatMap(CurationRepository, (repository) =>
      repository.updateImportJob({
        id: BigInt(jobId),
        status: "applying",
        validRecords,
        invalidRecords,
        completedAt: null,
        dryRun: false,
      }),
    ),
  );

const appliedDishIds = (jobId: string): Promise<Array<{ dishId: string }>> =>
  query(
    (sql) => sql<Array<{ dishId: string }>>`
      SELECT dish_id::text AS "dishId"
      FROM feastjourney.catalog_import_records
      WHERE job_id = ${jobId}::bigint AND status = 'applied' AND dish_id IS NOT NULL`,
  );

// ---------------------------------------------------------------------------
// Durable batching protocol: one logical job, bounded stage/apply calls,
// persisted cursors, global cross-batch duplicates, paginated issues.
// ---------------------------------------------------------------------------

const beginJob = (sourceName: string, totalRecords: number, license = MANUAL_LICENSE) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.beginImport({ sourceName, totalRecords, license }),
    ),
  );

const stageBatch = (jobId: string, baseIndex: number, records: ReadonlyArray<unknown>) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.stageImportBatch({ jobId, baseIndex, records }),
    ),
  );

const applyBatch = (jobId: string, limit?: number, duplicateRefs: ReadonlyArray<string> = []) => {
  const approvals = { licenseAck: true, reviewAck: true, duplicateRefs: [...duplicateRefs] };

  if (limit === undefined) {
    return run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImportBatch({ jobId, approvals, actorUserId: ACTOR }),
      ),
    );
  }

  return run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.applyImportBatch({ jobId, approvals, actorUserId: ACTOR, limit }),
    ),
  );
};

interface JobProgress {
  readonly status: string;
  readonly staged: number;
  readonly total: number;
  readonly valid: number;
  readonly invalid: number;
  readonly applied: number;
  readonly skipped: number;
  readonly applyFailed: number;
}

const jobProgress = async (jobId: string): Promise<JobProgress> => {
  const rows = await query<Array<JobProgress>>(
    (sql) => sql<Array<JobProgress>>`
      SELECT status, staged_count AS staged, total_records AS total,
        valid_records AS valid, invalid_records AS invalid,
        applied_count AS applied, skipped_count AS skipped,
        apply_failed_count AS "applyFailed"
      FROM feastjourney.catalog_import_jobs WHERE id = ${jobId}::bigint`,
  );

  const first = rows[0];

  if (first === undefined) {
    throw new Error(`expected import job ${jobId} to exist`);
  }

  return first;
};

const recordTallies = (jobId: string): Promise<Array<{ status: string; total: number }>> =>
  query(
    (sql) => sql<Array<{ status: string; total: number }>>`
      SELECT status, count(*)::int AS total
      FROM feastjourney.catalog_import_records
      WHERE job_id = ${jobId}::bigint GROUP BY status`,
  );

describe("import batching", () => {
  test("size 1: a single minimal record validates and applies", async () => {
    const report = await validateRecords(`batch-size-1-${stamp}`, [minimalRecord("one", 0)]);

    expect(report.totalRecords).toBe(1);
    expect(report.validRecords).toBe(1);
    expect(report.invalidRecords).toBe(0);
    expect(report.items).toHaveLength(1);

    const applied = await applyJob(report.jobId);

    expect(applied.applied).toBe(1);
    expect(applied.failed).toBe(0);
    expect(applied.skippedDuplicate).toBe(0);
  });

  test("size 100: exactly one hundred records validate in a single job", async () => {
    const records = Array.from({ length: 100 }, (_, index) => minimalRecord("hundred", index));
    const report = await validateRecords(`batch-size-100-${stamp}`, records);

    expect(report.totalRecords).toBe(100);
    expect(report.validRecords).toBe(100);
    expect(report.invalidRecords).toBe(0);
    expect(report.items).toHaveLength(100);
    expect(report.items[0]?.externalRef).toBe("record-1");
    expect(report.items[99]?.externalRef).toBe("record-100");
  }, 90_000);

  test("size 101: parser accepts, single-shot service still rejects", async () => {
    // Pin the shipped split: the JSON parse ceiling moved to
    // MAX_BATCHED_IMPORT_RECORDS (large datasets parse, then travel in
    // bounded stage batches), while the legacy single-shot service path
    // still caps records at 100 via ImportPayload. Durable batching is the
    // way past 100; the single-shot guard stays until it is removed.
    const records = Array.from({ length: 101 }, (_, index) => minimalRecord("oneohone", index));

    expect(MAX_IMPORT_RECORDS).toBe(100);
    expect(MAX_BATCHED_IMPORT_RECORDS).toBe(20_000);
    expect(jsonToRecords(JSON.stringify({ source_name: "x", records }))).toHaveLength(101);

    const failure = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName: `batch-size-101-${stamp}`,
          payload: { source_name: `batch-size-101-${stamp}`, records },
          license: MANUAL_LICENSE,
        }),
      ),
    );

    expect(failure._tag).toBe("InvalidDishData");
  });

  test("sizes 4474 and 10000 parse; only beyond the 20k logical bound fails", () => {
    // No DB touched. Full ingestion of these shapes is covered by the
    // batched protocol tests below; this pins the parse boundary so a
    // reintroduced file-level cap is caught here, not in production.
    for (const size of [4474, 10000]) {
      const records = Array.from({ length: size }, (_, index) => ({
        names: [{ language_tag: "en", name: `Shaped Dish ${index}`, name_kind: "localized" }],
        categories: ["soup"],
      }));

      expect(jsonToRecords(JSON.stringify({ source_name: "shaped", records }))).toHaveLength(size);
    }

    const over = Array.from({ length: MAX_BATCHED_IMPORT_RECORDS + 1 }, (_, index) => ({
      names: [{ language_tag: "en", name: `Over Dish ${index}`, name_kind: "localized" }],
      categories: ["soup"],
    }));

    expect(() => jsonToRecords(JSON.stringify({ source_name: "shaped", records: over }))).toThrow(
      /at most 20000 per import job/,
    );
  });

  test("bounded probe: 100 records is the single-shot service ceiling", async () => {
    // The legacy single-shot path still caps at ImportPayload's 100 records
    // (asserted above). This probe pins the largest payload that path
    // accepts and times it as the pre-batch baseline.
    const records = Array.from({ length: 100 }, (_, index) => minimalRecord("ceiling", index));
    const started = Date.now();
    const report = await validateRecords(`batch-ceiling-${stamp}`, records);
    const elapsedMs = Date.now() - started;

    expect(report.totalRecords).toBe(100);
    expect(report.validRecords).toBe(100);
    expect(report.items).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(90_000);
  });

  test("CSV parser has no count cap: the server-function guard is the enforcer", () => {
    // csvToRecords intentionally only shapes rows; the 100-record ceiling
    // for CSV uploads is enforced by adminImportValidateFn. Batching must
    // keep exactly one enforcement point when the cap is lifted.
    const header = "name,language_tag,name_kind,categories";

    const rows = Array.from(
      { length: 101 },
      (_, index) => `"Csv Cap Dish ${index} ${stamp}",en,localized,soup`,
    ).join("\n");

    const parsed = csvToRecords(`${header}\n${rows}`);

    expect(parsed).toHaveLength(101);
  });

  test("duplicate slugs inside one payload fail closed with no job created", async () => {
    const sourceName = `batch-dupe-${stamp}`;
    const slug = `batch-dupe-${stamp}`;

    const failure = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                slug,
                names: [{ language_tag: "en", name: `Dupe A ${stamp}`, name_kind: "localized" }],
                categories: ["soup"],
              },
              {
                slug,
                names: [{ language_tag: "en", name: `Dupe B ${stamp}`, name_kind: "localized" }],
                categories: ["soup"],
              },
            ],
          },
          license: MANUAL_LICENSE,
        }),
      ),
    );

    expect(failure._tag).toBe("InvalidDishData");

    const recent = await query<Array<{ source: string }>>(
      (sql) => sql<Array<{ source: string }>>`
        SELECT source_name AS source FROM feastjourney.catalog_import_jobs
        WHERE source_name = ${sourceName} LIMIT 1`,
    );

    expect(recent.some((job) => job.source === sourceName)).toBe(false);
  });

  test("same slug in a later job is flagged against the applied catalog", async () => {
    const slug = `batch-xjob-${stamp}`;
    const first = await validateRecords(`batch-xjob-a-${stamp}`, [minimalRecord("xjob", 0, slug)]);

    expect(first.validRecords).toBe(1);

    const appliedFirst = await applyJob(first.jobId);

    expect(appliedFirst.applied).toBe(1);

    // The slug now exists as a dish, so the next job's validation reports it
    // as an invalid record instead of silently staging a collision.
    const second = await validateRecords(`batch-xjob-b-${stamp}`, [minimalRecord("xjob", 0, slug)]);

    expect(second.totalRecords).toBe(1);
    expect(second.validRecords).toBe(0);
    expect(second.invalidRecords).toBe(1);
    expect(second.items[0]?.errors.join(" ")).toContain(slug);
  });

  test("invalid records at beginning/middle/end keep their original indices", async () => {
    const records = [0, 1, 2, 3, 4].map((index) => {
      const base = minimalRecord("indices", index);

      if (index % 2 === 0) {
        return {
          names: base.names,
          categories: base.categories,
          ingredients: [{ name: `unobtainium-xyz-${stamp}`, role: "core" }],
        };
      }

      return base;
    });

    const report = await validateRecords(`batch-indices-${stamp}`, records);

    expect(report.totalRecords).toBe(5);
    expect(report.validRecords).toBe(2);
    expect(report.invalidRecords).toBe(3);
    expect(report.items.map((item) => item.status)).toEqual([
      "invalid",
      "valid",
      "invalid",
      "valid",
      "invalid",
    ]);
    expect(report.items.map((item) => item.externalRef)).toEqual([
      "record-1",
      "record-2",
      "record-3",
      "record-4",
      "record-5",
    ]);
    expect(report.items[0]?.errors.join(" ")).toContain(`unobtainium-xyz-${stamp}`);
    expect(report.items[2]?.errors.join(" ")).toContain(`unobtainium-xyz-${stamp}`);
    expect(report.items[4]?.errors.join(" ")).toContain(`unobtainium-xyz-${stamp}`);
  });

  test("failed batch resumes without duplicating staged or applied rows", async () => {
    const report = await validateRecords(
      `batch-resume-${stamp}`,
      [0, 1, 2].map((index) => minimalRecord("resume", index)),
    );

    expect(report.validRecords).toBe(3);

    // Crash between claim and completion: job stranded in applying.
    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const resumed = await applyJob(report.jobId);

    expect(resumed.applied).toBe(3);
    expect(resumed.failed).toBe(0);

    const before = await appliedDishIds(report.jobId);

    expect(before).toHaveLength(3);

    // Crash again after full application: retry is a no-op, no dish rows
    // are duplicated and no counts drift.
    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const repeated = await applyJob(report.jobId);

    expect(repeated.applied).toBe(0);
    expect(repeated.skippedDuplicate).toBe(0);
    expect(repeated.failed).toBe(0);

    const after = await appliedDishIds(report.jobId);

    expect(after).toEqual(before);

    const finished = await query<Array<{ status: string }>>(
      (sql) => sql<Array<{ status: string }>>`
        SELECT status FROM feastjourney.catalog_import_jobs
        WHERE id = ${report.jobId}::bigint`,
    );

    expect(finished[0]?.status).toBe("applied");
  });

  test("page refresh re-enters through persisted job and record state", async () => {
    const report = await validateRecords(
      `batch-refresh-${stamp}`,
      [0, 1].map((index) => minimalRecord("refresh", index)),
    );

    // A refresh is a fresh process: it can only see what is persisted. The
    // job row plus per-record rows are the entire resume cursor today.
    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const reloaded = await query<Array<{ status: string; dry: boolean }>>(
      (sql) => sql<Array<{ status: string; dry: boolean }>>`
        SELECT status, dry_run AS dry FROM feastjourney.catalog_import_jobs
        WHERE id = ${report.jobId}::bigint`,
    );

    expect(reloaded[0]?.status).toBe("applying");
    expect(reloaded[0]?.dry).toBe(false);

    const pending = await query<Array<{ status: string }>>(
      (sql) => sql<Array<{ status: string }>>`
        SELECT status FROM feastjourney.catalog_import_records
        WHERE job_id = ${report.jobId}::bigint`,
    );

    expect(pending.filter((row) => row.status === "valid")).toHaveLength(2);

    const resumed = await applyJob(report.jobId);

    expect(resumed.applied).toBe(2);

    const dishIds = await appliedDishIds(report.jobId);

    expect(dishIds).toHaveLength(2);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(2);
  });

  test("concurrent apply yields exactly one winner with a typed loser conflict", async () => {
    const report = await validateRecords(
      `batch-race-${stamp}`,
      [0, 1, 2].map((index) => minimalRecord("race", index)),
    );

    expect(report.validRecords).toBe(3);

    const [left, right] = await Promise.allSettled([
      applyJob(report.jobId),
      applyJob(report.jobId),
    ]);

    let fulfilled = 0;
    let rejected = 0;
    let winnerApplied = 0;
    let loserConflict = false;

    for (const outcome of [left, right]) {
      if (outcome.status === "fulfilled") {
        fulfilled += 1;
        winnerApplied = outcome.value.applied;
      } else {
        rejected += 1;

        if (outcome.reason instanceof CatalogConflict) {
          loserConflict = true;
        }
      }
    }

    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    expect(winnerApplied).toBe(3);
    expect(loserConflict).toBe(true);

    const dishIds = await appliedDishIds(report.jobId);

    expect(dishIds).toHaveLength(3);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(3);
  });

  test("partial apply failure reports applied vs failed without false all-or-nothing", async () => {
    const parentSlug = `batch-partial-parent-${stamp}-real`;

    // Seed the parent dish through a throwaway job, then validate a job
    // whose child references it. Deleting the parent between validate and
    // apply breaks exactly one record at apply time: the report must show
    // the split instead of rolling everything back or claiming full success.
    const probe = await validateRecords(`batch-partial-parent-${stamp}`, [
      minimalRecord("partial-parent", 0, parentSlug),
    ]);

    const probeApplied = await applyJob(probe.jobId);

    expect(probeApplied.applied).toBe(1);

    const probeDish = (await appliedDishIds(probe.jobId))[0]?.dishId;

    expect(probeDish).toBeDefined();

    // Rewire is impossible post-validate, so the deterministic apply-time
    // failure is built differently: validate a job whose child references
    // the probe dish, then delete the probe dish before applying.
    const doomed = await validateRecords(`batch-partial-doomed-${stamp}`, [
      minimalRecord("doomed", 0),
      { ...minimalRecord("doomed", 1), parent_slug: parentSlug },
    ]);

    expect(doomed.validRecords).toBe(2);

    await query(
      (sql) => sql`DELETE FROM feastjourney.dishes WHERE id = ${probeDish ?? ""}::bigint`,
    );

    const outcome = await applyJob(doomed.jobId);

    // One row applied, the orphaned child failed: the report distinguishes
    // imported from rejected instead of claiming either extreme.
    expect(outcome.applied).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.skippedDuplicate).toBe(0);

    const rows = await query<Array<{ status: string; errors: string | null }>>(
      (sql) => sql<Array<{ status: string; errors: string | null }>>`
        SELECT status, errors::text AS errors FROM feastjourney.catalog_import_records
        WHERE job_id = ${doomed.jobId}::bigint`,
    );

    expect(rows.some((row) => row.status === "applied")).toBe(true);

    const failedRow = rows.find((row) => row.status === "invalid");

    expect(failedRow).toBeDefined();
    expect(failedRow?.errors ?? "").toContain("apply failed");

    const finished = await query<Array<{ status: string; valid: number; invalid: number }>>(
      (sql) => sql<Array<{ status: string; valid: number; invalid: number }>>`
        SELECT status, valid_records AS valid, invalid_records AS invalid
        FROM feastjourney.catalog_import_jobs WHERE id = ${doomed.jobId}::bigint`,
    );

    // Job-level validation counters stay frozen at validation semantics;
    // apply outcomes live on the rows and in the returned report.
    expect(finished[0]?.status).toBe("applied");
    expect(finished[0]?.valid).toBe(2);
    expect(finished[0]?.invalid).toBe(0);
  });

  test("record pagination stays bounded and ordered for issue review", async () => {
    const report = await validateRecords(
      `batch-pages-${stamp}`,
      Array.from({ length: 10 }, (_, index) => minimalRecord("pages", index)),
    );

    const firstPage = await query<Array<{ id: string }>>(
      (sql) => sql<Array<{ id: string }>>`
        SELECT id::text AS id FROM feastjourney.catalog_import_records
        WHERE job_id = ${report.jobId}::bigint ORDER BY id ASC LIMIT 4`,
    );

    expect(firstPage.length).toBeLessThanOrEqual(4);

    const ids = firstPage.map((row) => row.id);

    expect(ids.toSorted(compareIdText)).toEqual(ids);

    const header = await query<Array<{ id: string; status: string }>>(
      (sql) => sql<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status FROM feastjourney.catalog_import_jobs
        WHERE id = ${report.jobId}::bigint`,
    );

    expect(header[0]?.id).toBe(report.jobId);
    expect(header[0]?.status).toBe("validated");

    const detail = await run(
      Effect.flatMap(AdminDashboardService, (service) => service.importJobDetail(report.jobId, 4)),
    );

    expect(detail.records.length).toBeLessThanOrEqual(4);
  });

  test("batched begin reserves an open staged job with a zero cursor", async () => {
    const begun = await beginJob(`batch-begin-${stamp}`, 250);

    expect(begun.status).toBe("staged");
    expect(begun.stagedCount).toBe(0);
    expect(begun.totalRecords).toBe(250);

    const progress = await jobProgress(begun.jobId);

    expect(progress.status).toBe("staged");
    expect(progress.staged).toBe(0);
    expect(progress.total).toBe(250);
  });

  test("batched begin rejects empty and unbounded declarations", async () => {
    for (const totalRecords of [0, -5]) {
      // eslint-disable-next-line no-await-in-loop -- two sequential declarations; order is irrelevant but harmless.
      const failure = await runFailure(
        Effect.flatMap(CatalogImportService, (service) =>
          service.beginImport({ sourceName: `batch-begin-bad-${stamp}`, totalRecords }),
        ),
      );

      expect(failure).toBeInstanceOf(InvalidDishData);
    }
  });

  test("size 101 stages across two bounded batches with a 100-row stage cap", async () => {
    expect(IMPORT_STAGE_BATCH_SIZE).toBe(100);

    const begun = await beginJob(`batch-101-${stamp}`, 101);

    const first = await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 100 }, (_, index) => minimalRecord("b101", index)),
    );

    expect(first.stagedCount).toBe(100);
    expect(first.complete).toBe(false);
    expect(first.status).toBe("staged");
    expect(first.batchValid).toBe(100);

    const second = await stageBatch(begun.jobId, 100, [minimalRecord("b101", 100)]);

    expect(second.stagedCount).toBe(101);
    expect(second.complete).toBe(true);
    expect(second.status).toBe("validated");
    expect(second.batchValid).toBe(1);

    const tallies = await recordTallies(begun.jobId);
    const valid = tallies.find((row) => row.status === "valid")?.total ?? 0;

    expect(valid).toBe(101);
  }, 120_000);

  test("size 4474 stages a full dataset in bounded batches with stable indices", async () => {
    const total = 4474;
    const begun = await beginJob(`batch-4474-${stamp}`, total);
    const batchSize = IMPORT_STAGE_BATCH_SIZE;

    for (let base = 0; base < total; base += batchSize) {
      const size = Math.min(batchSize, total - base);

      // eslint-disable-next-line no-await-in-loop -- cursor-ordered batches; each commits before the next starts.
      const staged = await stageBatch(
        begun.jobId,
        base,
        Array.from({ length: size }, (_, offset) => minimalRecord("b4474", base + offset)),
      );

      expect(staged.stagedCount).toBe(base + size);
    }

    const progress = await jobProgress(begun.jobId);

    expect(progress.staged).toBe(total);
    expect(progress.status).toBe("validated");
    expect(progress.valid).toBe(total);

    const bounds = await query<Array<{ count: number; min: number; max: number }>>(
      (sql) => sql<Array<{ count: number; min: number; max: number }>>`
          SELECT count(*)::int AS count, min(record_index)::int AS min, max(record_index)::int AS max
          FROM feastjourney.catalog_import_records WHERE job_id = ${begun.jobId}::bigint`,
    );

    expect(bounds[0]).toEqual({ count: total, min: 0, max: total - 1 });

    const endpoints = await query<Array<{ ref: string }>>(
      (sql) => sql<Array<{ ref: string }>>`
          SELECT external_ref AS ref FROM feastjourney.catalog_import_records
          WHERE job_id = ${begun.jobId}::bigint AND record_index IN (0, ${total - 1})
          ORDER BY record_index ASC`,
    );

    expect(endpoints.map((row) => row.ref)).toEqual(["record-1", `record-${total}`]);

    // Bounded apply window: the client drains the job call by call instead
    // of one unbounded transaction; done stays false while valid rows remain.
    expect(IMPORT_APPLY_BATCH_SIZE).toBe(100);

    const window = await applyBatch(begun.jobId, 5);

    expect(window.applied).toBe(5);
    expect(window.done).toBe(false);
    expect(window.pending).toBe(total - 5);

    const afterApply = await jobProgress(begun.jobId);

    expect(afterApply.applied).toBe(5);
    expect(afterApply.status).toBe("applying");
  }, 300_000);

  test("size 10000 stages bounded windows with a persisted cursor and idempotent replay", async () => {
    const total = 10000;
    const begun = await beginJob(`batch-10000-${stamp}`, total);

    await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 100 }, (_, index) => minimalRecord("b10k", index)),
    );

    const second = await stageBatch(
      begun.jobId,
      100,
      Array.from({ length: 100 }, (_, index) => minimalRecord("b10k", 100 + index)),
    );

    expect(second.stagedCount).toBe(200);
    expect(second.complete).toBe(false);
    expect(second.status).toBe("staged");

    // Full 10k ingestion is a perf-harness concern, not asserted here:
    // what matters is the cursor (staged_count) surviving between calls.
    const progress = await jobProgress(begun.jobId);

    expect(progress.staged).toBe(200);
    expect(progress.total).toBe(total);

    // Retrying an already-committed batch replays progress without writing.
    const replay = await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 100 }, (_, index) => minimalRecord("b10k", index)),
    );

    expect(replay.stagedCount).toBe(200);
    expect(replay.batchValid).toBe(0);
    expect(replay.batchInvalid).toBe(0);

    const tallies = await recordTallies(begun.jobId);
    const staged = tallies.reduce((sum, row) => sum + row.total, 0);

    expect(staged).toBe(200);
  }, 120_000);

  test("duplicates across batches collapse into one global finding with both row numbers", async () => {
    const slug = `batch-xbatch-${stamp}`;
    const begun = await beginJob(`batch-xbatch-${stamp}`, 250);

    const first = await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 100 }, (_, index) =>
        index === 10 ? minimalRecord("xbatch", index, slug) : minimalRecord("xbatch", index),
      ),
    );

    expect(first.batchValid).toBe(100);

    // Batch 2 is clean filler; the clash lands in batch 3 (index 210).
    await stageBatch(
      begun.jobId,
      100,
      Array.from({ length: 100 }, (_, offset) => minimalRecord("xbatch", 100 + offset)),
    );

    const third = await stageBatch(
      begun.jobId,
      200,
      Array.from({ length: 50 }, (_, offset) => {
        const index = 200 + offset;

        return index === 210
          ? minimalRecord("xbatch", index, slug)
          : minimalRecord("xbatch", index);
      }),
    );

    expect(third.batchInvalid).toBe(1);
    expect(third.stagedCount).toBe(250);

    const clashes = await query<Array<{ index: number; status: string; errors: string | null }>>(
      (sql) => sql<Array<{ index: number; status: string; errors: string | null }>>`
          SELECT record_index AS index, status, errors::text AS errors
          FROM feastjourney.catalog_import_records
          WHERE job_id = ${begun.jobId}::bigint AND record_slug = ${slug}
          ORDER BY record_index ASC`,
    );

    // One global identity, two positions: the original stays valid, the
    // later occurrence carries the duplicate finding.
    expect(clashes.map((row) => row.index)).toEqual([10, 210]);
    expect(clashes.map((row) => row.status)).toEqual(["valid", "invalid"]);
    expect(clashes[1]?.errors ?? "").toContain(slug);
  }, 120_000);

  test("failed batch retry resumes from the cursor without duplicating rows", async () => {
    const begun = await beginJob(`batch-retry-${stamp}`, 20);

    const records = Array.from({ length: 10 }, (_, index) => {
      const base = minimalRecord("retry", index);

      if (index === 9) {
        return {
          names: base.names,
          categories: base.categories,
          ingredients: [{ name: `unobtainium-xyz-${stamp}`, role: "core" }],
        };
      }

      return base;
    });

    const first = await stageBatch(begun.jobId, 0, records);

    expect(first.batchValid).toBe(9);
    expect(first.batchInvalid).toBe(1);
    expect(first.complete).toBe(false);
    expect(first.status).toBe("staged");

    // Retry of an already-committed range replays progress without writing.
    // (Replay is a mid-job operation: once the final batch flips the job out
    // of staged, resending a batch is a cursor conflict, not a replay.)
    const replay = await stageBatch(begun.jobId, 0, records);

    expect(replay.batchValid).toBe(0);
    expect(replay.batchInvalid).toBe(0);
    expect(replay.stagedCount).toBe(10);

    const tallies = await recordTallies(begun.jobId);
    const staged = tallies.reduce((sum, row) => sum + row.total, 0);

    expect(staged).toBe(10);

    const second = await stageBatch(
      begun.jobId,
      10,
      Array.from({ length: 10 }, (_, offset) => minimalRecord("retry", 10 + offset)),
    );

    expect(second.complete).toBe(true);
    expect(second.status).toBe("validated");

    // The job still drains: 19 valid rows apply, the invalid row never replays.
    const applied = await applyBatch(begun.jobId);

    expect(applied.applied).toBe(19);
    expect(applied.done).toBe(true);

    // Past done, re-entry is a typed conflict (exactly-once holds: no row
    // can apply twice, and the loser gets a conflict, not a silent no-op).
    const repeated = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImportBatch({
          jobId: begun.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [] },
          actorUserId: ACTOR,
        }),
      ),
    );

    expect(repeated).toBeInstanceOf(CatalogConflict);
  });

  test("off-cursor batch is a typed conflict naming the exact resume point", async () => {
    const begun = await beginJob(`batch-cursor-${stamp}`, 100);

    const failure = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.stageImportBatch({
          jobId: begun.jobId,
          baseIndex: 50,
          records: [minimalRecord("cursor", 50)],
        }),
      ),
    );

    expect(failure).toBeInstanceOf(CatalogConflict);

    if (failure instanceof CatalogConflict) {
      expect(failure.reason).toContain("resume cursor is 0");
    }
  });

  test("batch overrunning the declared total fails closed", async () => {
    const begun = await beginJob(`batch-overrun-${stamp}`, 100);

    await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 60 }, (_, index) => minimalRecord("overrun", index)),
    );

    const failure = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.stageImportBatch({
          jobId: begun.jobId,
          baseIndex: 60,
          records: Array.from({ length: 50 }, (_, offset) => minimalRecord("overrun", 60 + offset)),
        }),
      ),
    );

    expect(failure).toBeInstanceOf(InvalidDishData);
  });

  test("page refresh re-enters through persisted cursor and paginated issues", async () => {
    const begun = await beginJob(`batch-refresh-${stamp}`, 200);

    await stageBatch(
      begun.jobId,
      0,
      Array.from({ length: 100 }, (_, index) => minimalRecord("refresh", index)),
    );

    // A refresh is a fresh process: staged_count plus keyset-paginated issue
    // rows are the entire resume state — nothing restarts from zero.
    const progress = await jobProgress(begun.jobId);

    expect(progress.staged).toBe(100);

    const firstPage = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.importJobIssues({ jobId: begun.jobId, limit: 40 }),
      ),
    );

    expect(firstPage.totals.total).toBe(100);
    expect(firstPage.records.length).toBeLessThanOrEqual(40);
    expect(firstPage.nextCursor).not.toBeNull();

    const cursor = firstPage.nextCursor;

    expect(cursor).not.toBeNull();

    const secondPage = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.importJobIssues({
          jobId: begun.jobId,
          limit: 100,
          cursor: cursor ?? "0",
        }),
      ),
    );

    expect(secondPage.records.length).toBeGreaterThan(0);

    const resumed = await stageBatch(
      begun.jobId,
      100,
      Array.from({ length: 100 }, (_, index) => minimalRecord("refresh", 100 + index)),
    );

    expect(resumed.stagedCount).toBe(200);
    expect(resumed.complete).toBe(true);
  });

  test("bounded apply reports progress and accumulates counters per batch", async () => {
    const begun = await beginJob(`batch-apply-${stamp}`, 3);

    await stageBatch(
      begun.jobId,
      0,
      [0, 1, 2].map((index) => minimalRecord("apply", index)),
    );

    const window = await applyBatch(begun.jobId, 2);

    expect(window.applied).toBe(2);
    expect(window.failed).toBe(0);
    expect(window.done).toBe(false);
    expect(window.pending).toBe(1);

    const mid = await jobProgress(begun.jobId);

    expect(mid.applied).toBe(2);
    expect(mid.status).toBe("applying");

    const rest = await applyBatch(begun.jobId, 2);

    expect(rest.applied).toBe(1);
    expect(rest.done).toBe(true);
    expect(rest.pending).toBe(0);

    const finished = await jobProgress(begun.jobId);

    expect(finished.status).toBe("applied");
    expect(finished.applied).toBe(3);

    const dishIds = await appliedDishIds(begun.jobId);

    expect(dishIds).toHaveLength(3);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(3);
  });

  test("concurrent batched apply yields exactly-once application", async () => {
    const begun = await beginJob(`batch-race-${stamp}`, 3);

    await stageBatch(
      begun.jobId,
      0,
      [0, 1, 2].map((index) => minimalRecord("brace", index)),
    );

    const [left, right] = await Promise.allSettled([
      applyBatch(begun.jobId),
      applyBatch(begun.jobId),
    ]);

    let fulfilled = 0;
    let rejected = 0;
    let loserConflict = false;

    for (const outcome of [left, right]) {
      if (outcome.status === "fulfilled") {
        fulfilled += 1;
      } else {
        rejected += 1;

        if (outcome.reason instanceof CatalogConflict) {
          loserConflict = true;
        }
      }
    }

    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    expect(loserConflict).toBe(true);

    const dishIds = await appliedDishIds(begun.jobId);

    expect(dishIds).toHaveLength(3);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(3);
  });

  test("batched partial apply failure distinguishes imported from rejected", async () => {
    const parentSlug = `batch-partial-parent-${stamp}`;
    const probe = await beginJob(`batch-partial-probe-${stamp}`, 1);

    await stageBatch(probe.jobId, 0, [minimalRecord("partial-probe", 0, parentSlug)]);
    await applyBatch(probe.jobId);

    const probeDish = (await appliedDishIds(probe.jobId))[0]?.dishId;

    expect(probeDish).toBeDefined();

    const begun = await beginJob(`batch-partial-doomed-${stamp}`, 2);

    await stageBatch(begun.jobId, 0, [
      minimalRecord("doomed", 0),
      { ...minimalRecord("doomed", 1), parent_slug: parentSlug },
    ]);

    await query(
      (sql) => sql`DELETE FROM feastjourney.dishes WHERE id = ${probeDish ?? ""}::bigint`,
    );

    const outcome = await applyBatch(begun.jobId);

    // Sibling applies; the orphaned child fails: no false all-or-nothing.
    expect(outcome.applied).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.done).toBe(true);

    const tallies = await recordTallies(begun.jobId);
    const appliedRows = tallies.find((row) => row.status === "applied")?.total ?? 0;
    const invalidRows = tallies.find((row) => row.status === "invalid")?.total ?? 0;

    expect(appliedRows).toBe(1);
    expect(invalidRows).toBe(1);

    const failed = await query<Array<{ errors: string | null }>>(
      (sql) => sql<Array<{ errors: string | null }>>`
        SELECT errors::text AS errors FROM feastjourney.catalog_import_records
        WHERE job_id = ${begun.jobId}::bigint AND status = 'invalid'`,
    );

    expect(failed[0]?.errors ?? "").toContain("apply failed");
  });

  test("actors without food:import are denied at the permission boundary", async () => {
    const plain = await foodAuth.signupSignin("batch-import-plain");

    const denied = await runFailure(
      requirePermission(new Headers({ cookie: plain.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(denied._tag).toBe("InsufficientPermissions");

    const importer = await foodAuth.signupSignin("batch-import-owner");
    await foodAuth.grantRole(importer.userId, "owner");

    const allowed = await run(
      requirePermission(new Headers({ cookie: importer.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(allowed.userId).toBe(importer.userId);
  });
});
