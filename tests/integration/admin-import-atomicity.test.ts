// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import { CatalogConflict } from "@/modules/food-discovery/server/domain/errors";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const stamp = Date.now().toString(36);

const ACTOR = "atomicity:test-approver";

// Repository rows are Reylo-inferred (tsc is the authority there); this test
// reads back state through explicitly typed SQL projections instead, so every
// assertion below is fully typed under both tsc and oxlint.
const query = async <T>(statement: (sql: SQL) => Promise<T>): Promise<T> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    return await statement(sql);
  } finally {
    await sql.end();
  }
};

const validateRecords = (
  sourceName: string,
  records: ReadonlyArray<unknown>,
  license = "manual:manual-entry",
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

interface JobCounters {
  readonly status: string;
  readonly dryRun: boolean;
  readonly totalRecords: number;
  readonly validRecords: number;
  readonly invalidRecords: number;
}

const jobCounters = async (jobId: string): Promise<JobCounters> => {
  const rows = await query<Array<JobCounters>>(
    (sql) => sql<Array<JobCounters>>`
      SELECT status, dry_run AS "dryRun", total_records AS "totalRecords",
        valid_records AS "validRecords", invalid_records AS "invalidRecords"
      FROM feastjourney.catalog_import_jobs
      WHERE id = ${jobId}::bigint`,
  );

  const first = rows[0];

  if (first === undefined) {
    throw new Error(`expected import job ${jobId} to exist`);
  }

  return first;
};

const appliedDishIds = (jobId: string): Promise<Array<{ dishId: string }>> =>
  query(
    (sql) => sql<Array<{ dishId: string }>>`
      SELECT dish_id::text AS "dishId"
      FROM feastjourney.catalog_import_records
      WHERE job_id = ${jobId}::bigint AND status = 'applied' AND dish_id IS NOT NULL`,
  );

const recordTotalsByStatus = (jobId: string): Promise<Array<{ status: string; total: number }>> =>
  query(
    (sql) => sql<Array<{ status: string; total: number }>>`
      SELECT status, count(*)::int AS total
      FROM feastjourney.catalog_import_records
      WHERE job_id = ${jobId}::bigint
      GROUP BY status`,
  );

const slugCatalog = (): Promise<Array<{ slug: string }>> =>
  query(
    (sql) => sql<Array<{ slug: string }>>`
    SELECT slug FROM feastjourney.dishes WHERE slug LIKE ${`%${stamp}%`} ORDER BY slug`,
  );

describe("admin import atomicity", () => {
  test("concurrent applies yield exactly-once application with a typed loser conflict", async () => {
    const sourceName = `atomicity-race-${stamp}`;
    const names = ["Alpha", "Beta", "Gamma"].map((dish) => `Atomicity Race ${dish} ${stamp}`);

    const report = await validateRecords(
      sourceName,
      names.map((name) => ({
        names: [{ language_tag: "en", name, name_kind: "localized" }],
        categories: ["soup"],
      })),
    );

    expect(report.validRecords).toBe(3);

    const [left, right] = await Promise.allSettled([
      applyJob(report.jobId),
      applyJob(report.jobId),
    ]);

    let fulfilled = 0;
    let winnerApplied = 0;
    let rejected = 0;
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

    const finished = await jobCounters(report.jobId);

    expect(finished.status).toBe("applied");
    expect(finished.dryRun).toBe(false);

    const dishIds = await appliedDishIds(report.jobId);

    expect(dishIds.length).toBe(3);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(3);
  });

  test("crash resume completes a stranded applying job without duplicates", async () => {
    const sourceName = `atomicity-resume-${stamp}`;
    const names = [`Atomicity Resume One ${stamp}`, `Atomicity Resume Two ${stamp}`];

    const report = await validateRecords(
      sourceName,
      names.map((name) => ({
        names: [{ language_tag: "en", name, name_kind: "localized" }],
        categories: ["soup"],
      })),
    );

    expect(report.validRecords).toBe(2);

    // Simulate a crash between the claim and completion: the job is left in
    // applying with dry_run already cleared, exactly as the claim writes it.
    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const resumed = await applyJob(report.jobId);

    expect(resumed.applied).toBe(2);
    expect(resumed.failed).toBe(0);

    const slugsBefore = await slugCatalog();

    // Re-running over a fully applied job (stranded in applying again) is a
    // no-op: every record is skipped by row status, no dish is duplicated.
    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const repeated = await applyJob(report.jobId);

    expect(repeated.applied).toBe(0);
    expect(repeated.skippedDuplicate).toBe(0);
    expect(repeated.failed).toBe(0);

    const slugsAfter = await slugCatalog();

    expect(slugsAfter).toEqual(slugsBefore);

    const finished = await jobCounters(report.jobId);

    expect(finished.status).toBe("applied");
  });

  test("crash resume finishes a half-applied job without duplicating dishes", async () => {
    const sourceName = `atomicity-half-${stamp}`;
    const first = `Atomicity Half One ${stamp}`;
    const second = `Atomicity Half Two ${stamp}`;

    const report = await validateRecords(
      sourceName,
      [first, second].map((name) => ({
        names: [{ language_tag: "en", name, name_kind: "localized" }],
        categories: ["soup"],
      })),
    );

    const full = await applyJob(report.jobId);

    expect(full.applied).toBe(2);

    const applied = await appliedDishIds(report.jobId);

    expect(applied.length).toBe(2);

    const rewound = applied[0];

    if (rewound === undefined) {
      throw new Error("expected an applied record with a dish to rewind");
    }

    // Simulate a crash after one record committed but the other did not:
    // resolve the doomed record first (deleting its dish SET NULLs the
    // dish_id link), then drop the dish (cascades its links) and rewind
    // the record to valid, with the job stranded in applying.
    const targets = await query<Array<{ recordId: string }>>(
      (sql) => sql<Array<{ recordId: string }>>`
        SELECT id::text AS "recordId"
        FROM feastjourney.catalog_import_records
        WHERE job_id = ${report.jobId}::bigint AND dish_id::text = ${rewound.dishId}`,
    );

    const target = targets[0];

    if (target === undefined) {
      throw new Error("expected a matching import record to rewind");
    }

    await query<unknown>(
      (sql) => sql`DELETE FROM feastjourney.dishes WHERE id = ${rewound.dishId}::bigint`,
    );

    await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.updateImportRecord({
          id: BigInt(target.recordId),
          status: "valid",
          errors: null,
          dishId: null,
        }),
      ),
    );

    await strandInApplying(report.jobId, report.validRecords, report.invalidRecords);

    const resumed = await applyJob(report.jobId);

    expect(resumed.applied).toBe(1);

    const dishIds = await appliedDishIds(report.jobId);

    expect(dishIds.length).toBe(2);
    expect(new Set(dishIds.map((row) => row.dishId)).size).toBe(2);
  });

  test("same slugless payload in two jobs never shares source identity", async () => {
    const name = `Atomicity Identity ${stamp}`;

    const first = await validateRecords(`atomicity-identity-a-${stamp}`, [
      {
        names: [{ language_tag: "en", name, name_kind: "localized" }],
        categories: ["soup"],
        editorial_note: "first import of a shared slugless payload",
      },
    ]);

    const appliedFirst = await applyJob(first.jobId);

    expect(appliedFirst.applied).toBe(1);

    const second = await validateRecords(`atomicity-identity-b-${stamp}`, [
      {
        names: [{ language_tag: "en", name, name_kind: "localized" }],
        categories: ["soup"],
        editorial_note: "second import of a shared slugless payload",
      },
    ]);

    const appliedSecond = await applyJob(second.jobId);

    expect(appliedSecond.applied).toBe(1);

    const firstExternalId = `${first.jobId}:record-1`;
    const secondExternalId = `${second.jobId}:record-1`;

    const stored = await query<Array<{ externalId: string; payload: string }>>(
      (sql) => sql<Array<{ externalId: string; payload: string }>>`
        SELECT r.external_id AS "externalId", r.payload::text AS payload
        FROM feastjourney.source_records AS r
        JOIN feastjourney.source_providers AS p ON p.id = r.provider_id
        WHERE p.slug = 'manual'
          AND r.external_id IN (${firstExternalId}, ${secondExternalId})
        ORDER BY r.external_id ASC`,
    );

    expect(stored.length).toBe(2);
    expect(stored.map((row) => row.externalId).toSorted()).toEqual(
      [firstExternalId, secondExternalId].toSorted(),
    );

    const firstPayload = stored.find((row) => row.externalId === firstExternalId)?.payload ?? "";
    const secondPayload = stored.find((row) => row.externalId === secondExternalId)?.payload ?? "";

    // The second job's upsert targeted its own job-scoped identity, so the
    // first job's source payload still describes the first import.
    expect(firstPayload).toContain("first import of a shared slugless payload");
    expect(firstPayload).not.toContain("second import of a shared slugless payload");
    expect(secondPayload).toContain("second import of a shared slugless payload");

    const firstDishIds = await appliedDishIds(first.jobId);
    const secondDishIds = await appliedDishIds(second.jobId);

    expect(firstDishIds.length).toBe(1);
    expect(secondDishIds.length).toBe(1);

    const firstDish = firstDishIds[0]?.dishId;
    const secondDish = secondDishIds[0]?.dishId;

    expect(firstDish).not.toBe(secondDish);

    if (firstDish === undefined || secondDish === undefined) {
      throw new Error("expected one applied dish per identity job");
    }

    const links = await query<Array<{ dishId: string; externalId: string }>>(
      (sql) => sql<Array<{ dishId: string; externalId: string }>>`
        SELECT ds.dish_id::text AS "dishId", r.external_id AS "externalId"
        FROM feastjourney.dish_sources AS ds
        JOIN feastjourney.source_records AS r ON r.id = ds.source_record_id
        WHERE ds.dish_id::text IN (${firstDish}, ${secondDish})`,
    );

    expect(links.find((link) => link.dishId === firstDish)?.externalId).toBe(firstExternalId);
    expect(links.find((link) => link.dishId === secondDish)?.externalId).toBe(secondExternalId);
  });

  test("apply preserves validation counts while tracking row outcomes", async () => {
    const sourceName = `atomicity-counters-${stamp}`;

    const report = await validateRecords(sourceName, [
      {
        names: [{ language_tag: "en", name: `Atomicity Counted ${stamp}`, name_kind: "localized" }],
        categories: ["soup"],
      },
      {
        names: [
          { language_tag: "en", name: `Atomicity Uncounted ${stamp}`, name_kind: "localized" },
        ],
        ingredients: [{ name: "unobtainium-xyz", role: "core" }],
      },
    ]);

    expect(report.validRecords).toBe(1);
    expect(report.invalidRecords).toBe(1);

    const applied = await applyJob(report.jobId);

    expect(applied.applied).toBe(1);
    expect(applied.failed).toBe(0);

    const finished = await jobCounters(report.jobId);

    expect(finished.status).toBe("applied");
    expect(finished.totalRecords).toBe(2);
    expect(finished.validRecords).toBe(1);
    expect(finished.invalidRecords).toBe(1);
    expect(finished.totalRecords).toBe(finished.validRecords + finished.invalidRecords);
    expect(finished.validRecords).toBeGreaterThanOrEqual(applied.applied);

    const totals = await recordTotalsByStatus(report.jobId);
    const appliedRows = totals.find((row) => row.status === "applied")?.total ?? 0;

    expect(appliedRows).toBe(1);
  });
});
