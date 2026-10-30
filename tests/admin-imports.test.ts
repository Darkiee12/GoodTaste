// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { Effect } from "effect";
import { z } from "zod";

import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { requirePermission } from "@/server/auth/session";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./integration/food-auth";

/**
 * Feast Lab import-studio administration. The imports list pages through
 * `importJobs(limit, offset)` and the detail view reads
 * `importJobDetail(jobId, recordLimit)`; both must surface the `applying`
 * state, and the validate-to-apply lifecycle must stay intact end to end.
 * Backend integration style: every invariant runs through the real
 * services against PostgreSQL, no mocks.
 *
 * Rows cross into the test through the same zod wire shape the routes
 * parse, so assertions stay on the page contract without coupling to
 * Reylo's inferred row types (tsc remains the authority there).
 */

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const stamp = Date.now().toString(36);
const ACTOR = `tlab:import-approver-${stamp}`;

const importJobSchema = z.object({
  id: z.string(),
  source_name: z.string(),
  status: z.string(),
  dry_run: z.boolean(),
});

const importJobPageSchema = z.array(importJobSchema);

const importJobDetailSchema = z.object({
  job: importJobSchema,
  records: z.array(z.object({ status: z.string() })),
});

type ImportJobPage = z.infer<typeof importJobPageSchema>;

type ImportJobDetail = z.infer<typeof importJobDetailSchema>;

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const validateJob = (sourceName: string, dishName: string) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.validateImport({
        sourceName,
        payload: {
          source_name: sourceName,
          records: [
            {
              names: [{ language_tag: "en", name: dishName, name_kind: "localized" }],
              categories: ["soup"],
            },
          ],
        },
        license: "manual:manual-entry",
      }),
    ),
  );

const applyJob = (jobId: string) =>
  run(
    Effect.flatMap(CatalogImportService, (service) =>
      service.applyImport({
        jobId,
        approvals: { licenseAck: false, reviewAck: true, duplicateRefs: [] },
        actorUserId: ACTOR,
      }),
    ),
  );

const listJobs = async (limit: number, offset: number): Promise<ImportJobPage> =>
  importJobPageSchema.parse(
    await run(
      Effect.flatMap(AdminDashboardService, (service) => service.importJobs(limit, offset)),
    ),
  );

const jobDetail = async (jobId: string, recordLimit: number): Promise<ImportJobDetail> =>
  importJobDetailSchema.parse(
    await run(
      Effect.flatMap(AdminDashboardService, (service) =>
        service.importJobDetail(jobId, recordLimit),
      ),
    ),
  );

const prefix = `tlab-imports-${stamp}`;

describe("Feast Lab import-studio administration", () => {
  test("job list pages bounded with no duplicates across pages", async () => {
    const sources = Array.from({ length: 5 }, (_, index) => `${prefix}-page-${index}`);

    await Promise.all(
      sources.map((source, index) => validateJob(source, `Tlab Page Dish ${stamp} ${index}`)),
    );

    const pageOne = await listJobs(2, 0);
    const pageTwo = await listJobs(2, 2);
    const pageThree = await listJobs(2, 4);

    expect(pageOne.length).toBeLessThanOrEqual(2);
    expect(pageTwo.length).toBeLessThanOrEqual(2);
    expect(pageThree.length).toBeLessThanOrEqual(2);

    const seen = new Set<string>();
    let ours = 0;

    for (const page of [pageOne, pageTwo, pageThree]) {
      for (const job of page) {
        expect(seen.has(job.id)).toBe(false);
        seen.add(job.id);

        if (sources.includes(job.source_name)) {
          ours += 1;
        }
      }
    }

    // Pages are newest-first; our five jobs land in the first pages.
    // Full-universe assertions would be brittle against parallel suites,
    // so the invariant is bounded pages with no repeats.
    expect(ours).toBeGreaterThanOrEqual(4);
  });

  test("applying jobs surface in the list and the detail view", async () => {
    const source = `${prefix}-applying`;
    const report = await validateJob(source, `Tlab Applying Dish ${stamp}`);

    expect(
      importJobSchema
        .pick({ status: true })
        .parse(
          await run(
            Effect.flatMap(CurationRepository, (repository) =>
              repository.claimImportJobForApply(BigInt(report.jobId)),
            ),
          ),
        ).status,
    ).toBe("applying");

    const listed = (await listJobs(50, 0)).find((job) => job.id === report.jobId);

    expect(listed?.status).toBe("applying");

    const detail = await jobDetail(report.jobId, 100);

    expect(detail.job.status).toBe("applying");
    expect(detail.job.source_name).toBe(source);
    expect(detail.records.length).toBeGreaterThan(0);

    // Leave no stranded job behind: finish the lifecycle.
    const applied = await applyJob(report.jobId);

    expect(applied.applied).toBe(1);
  });

  test("validate-to-apply lifecycle stays intact through list and detail", async () => {
    const source = `${prefix}-lifecycle`;
    const report = await validateJob(source, `Tlab Lifecycle Dish ${stamp}`);

    expect(report.validRecords).toBe(1);

    const staged = (await listJobs(50, 0)).find((job) => job.id === report.jobId);

    expect(staged?.status).toBe("validated");
    expect(staged?.dry_run).toBe(true);

    const applied = await applyJob(report.jobId);

    expect(applied.applied).toBe(1);

    const finished = (await listJobs(50, 0)).find((job) => job.id === report.jobId);

    expect(finished?.status).toBe("applied");
    expect(finished?.dry_run).toBe(false);

    const detail = await jobDetail(report.jobId, 100);

    expect(detail.job.status).toBe("applied");
    expect(detail.records.some((record) => record.status === "applied")).toBe(true);
  });

  test("import detail rejects unknown jobs with a typed failure", async () => {
    const missing = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) => service.importJobDetail("999999999", 100)),
    );

    expect(missing._tag).toBe("DishNotFound");
  });

  test("actors without food:import are denied at the operation boundary", async () => {
    const plain = await foodAuth.signupSignin("tlab-import-plain");

    const denied = await runFailure(
      requirePermission(new Headers({ cookie: plain.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(denied._tag).toBe("InsufficientPermissions");

    const importer = await foodAuth.signupSignin("tlab-import-owner");
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
