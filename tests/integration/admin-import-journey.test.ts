// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect, Match } from "effect";

import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { DishRelationsRepository } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./food-auth";

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const stamp = Date.now().toString(36);

const seedProvider = async (slug: string, name: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.source_providers (slug, name)
    VALUES (${slug}, ${name}) ON CONFLICT (slug) DO NOTHING`;
  await sql.end();
};

describe("admin import journey", () => {
  test("rejects duplicate slugs with no job created", async () => {
    const sourceName = `dup-slug-source-${stamp}`;
    const slug = `dup-slug-${stamp}`;

    const failure = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                slug,
                names: [{ language_tag: "en", name: "Dup Dish A", name_kind: "localized" }],
                categories: ["soup"],
              },
              {
                slug,
                names: [{ language_tag: "en", name: "Dup Dish B", name_kind: "localized" }],
                categories: ["soup"],
              },
            ],
          },
          license: "manual:manual-entry",
        }),
      ),
    );

    expect(failure._tag).toBe("InvalidDishData");

    const duplicateReason = Match.value(failure).pipe(
      Match.tag("InvalidDishData", (invalid) => invalid.reason),
      Match.orElse(() => null),
    );

    expect(duplicateReason).toContain(slug);

    const recent = await run(
      Effect.flatMap(CurationRepository, (repository) => repository.recentImportJobs(50)),
    );

    expect(recent.some((job) => job.source_name === sourceName)).toBe(false);
  });

  test("partial validation applies valid rows and skips invalid ones", async () => {
    const sourceName = `mixed-source-${stamp}`;

    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                names: [
                  {
                    language_tag: "en",
                    name: `Journey Valid ${stamp}`,
                    name_kind: "localized",
                  },
                ],
                categories: ["soup"],
              },
              {
                names: [
                  {
                    language_tag: "en",
                    name: `Journey Invalid ${stamp}`,
                    name_kind: "localized",
                  },
                ],
                ingredients: [{ name: "unobtainium-xyz", role: "core" }],
              },
            ],
          },
          license: "manual:manual-entry",
        }),
      ),
    );

    expect(report.validRecords).toBe(1);
    expect(report.invalidRecords).toBe(1);
    expect(report.items.map((item) => item.status)).toEqual(["valid", "invalid"]);

    const stored = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.adminFindImportJob(BigInt(report.jobId)),
      ),
    );

    expect(stored?.status).toBe("validated");
    expect(stored?.dry_run).toBe(true);

    const applied = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: false, reviewAck: true, duplicateRefs: [] },
          actorUserId: "admin:test-approver",
        }),
      ),
    );

    expect(applied.applied).toBe(1);
    expect(applied.failed).toBe(0);

    const finished = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.adminFindImportJob(BigInt(report.jobId)),
      ),
    );

    expect(finished?.status).toBe("applied");
    expect(finished?.dry_run).toBe(false);

    const records = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.recordsByJobId(BigInt(report.jobId), 100),
      ),
    );

    const appliedRow = records.find((row) => row.status === "applied");

    expect(appliedRow?.dish_id).not.toBeNull();

    const dishId = (appliedRow?.dish_id ?? 0n).toString();

    const publicFailure = await runFailure(
      Effect.flatMap(DishService, (service) => service.getDish(dishId, "en")),
    );

    expect(publicFailure._tag).toBe("DishNotFound");

    const curated = await run(
      Effect.flatMap(DishService, (service) => service.getDishForCuration(dishId, "en")),
    );

    expect(curated.id).toBe(dishId);
    expect(curated.status).toBe("review");

    const check = await run(
      Effect.flatMap(AdminDashboardService, (service) => service.publicationCheck(dishId)),
    );

    expect(check.publishable).toBe(false);
    expect(check.reasons.length).toBeGreaterThan(0);
  });

  test("apply without required acks fails and leaves the job staged", async () => {
    const sourceName = `acks-source-${stamp}`;

    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                names: [{ language_tag: "en", name: `Acks Dish ${stamp}`, name_kind: "localized" }],
                categories: ["soup"],
              },
            ],
          },
          license: "other:unknown",
        }),
      ),
    );

    expect(report.validRecords).toBe(1);

    const missingLicense = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: false, reviewAck: true, duplicateRefs: [] },
          actorUserId: "admin:test-approver",
        }),
      ),
    );

    expect(missingLicense._tag).toBe("InvalidDishData");

    const missingReview = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: true, reviewAck: false, duplicateRefs: [] },
          actorUserId: "admin:test-approver",
        }),
      ),
    );

    expect(missingReview._tag).toBe("InvalidDishData");

    const untouched = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.adminFindImportJob(BigInt(report.jobId)),
      ),
    );

    expect(untouched?.status).toBe("validated");
    expect(untouched?.dry_run).toBe(true);
  });

  test("apply with acks persists approvals, provenance, and clears dry_run", async () => {
    const approver = await foodAuth.signupSignin("import-approver");
    const sourceName = `approved-source-${stamp}`;

    await seedProvider("other", "Other test source");

    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                names: [
                  {
                    language_tag: "en",
                    name: `Approved Dish ${stamp}`,
                    name_kind: "localized",
                  },
                ],
                places: [{ iso: "VN", association: "origin" }],
                cuisines: ["vietnamese"],
                categories: ["soup"],
              },
            ],
          },
          license: "other:unknown",
        }),
      ),
    );

    expect(report.validRecords).toBe(1);

    const applied = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [] },
          actorUserId: approver.userId,
        }),
      ),
    );

    expect(applied.applied).toBe(1);

    const stored = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.findImportJobForApply(BigInt(report.jobId)),
      ),
    );

    expect(stored?.approved_by).toBe(approver.userId);
    expect(stored?.approved_at).not.toBeNull();
    expect(stored?.license_ack).toBe(true);
    expect(stored?.review_ack).toBe(true);
    expect(JSON.parse(stored?.acknowledged_duplicates ?? "null")).toEqual([]);
    expect(stored?.dry_run).toBe(false);

    const records = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.recordsByJobId(BigInt(report.jobId), 100),
      ),
    );

    const appliedRow = records.find((row) => row.status === "applied");

    expect(appliedRow?.dish_id).not.toBeNull();

    const sources = await run(
      Effect.flatMap(DishRelationsRepository, (repository) =>
        repository.sourcesByDishIds([appliedRow?.dish_id ?? 0n]),
      ),
    );

    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0]?.provider).toBe("other");
    // Slugless records use job-relative refs, so provenance scopes them
    // with the job id (`<jobId>:record-N`); slugged records reuse the slug.
    expect(sources[0]?.external_id).toBe(`${report.jobId}:${appliedRow?.external_ref}`);
    expect(sources[0]?.license).toBe("other:unknown");
  });

  test("duplicate rows require acknowledgement before apply", async () => {
    const sourceName = `dupe-source-${stamp}`;

    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                names: [
                  {
                    language_tag: "en",
                    name: `Approved Dish ${stamp}`,
                    name_kind: "localized",
                  },
                ],
                places: [{ iso: "VN", association: "origin" }],
                cuisines: ["vietnamese"],
                categories: ["soup"],
              },
            ],
          },
          license: "other:unknown",
        }),
      ),
    );

    expect(report.validRecords).toBe(1);

    const duplicateRef = report.items[0]?.externalRef ?? "";

    expect(report.items[0]?.duplicateOf).not.toBeNull();

    const unacked = await runFailure(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [] },
          actorUserId: "admin:test-approver",
        }),
      ),
    );

    expect(unacked._tag).toBe("InvalidDishData");

    const unackedReason = Match.value(unacked).pipe(
      Match.tag("InvalidDishData", (invalid) => invalid.reason),
      Match.orElse(() => null),
    );

    expect(unackedReason).toContain(duplicateRef);

    const acked = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [duplicateRef] },
          actorUserId: "admin:test-approver",
        }),
      ),
    );

    expect(acked.applied).toBe(1);

    const stored = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.findImportJobForApply(BigInt(report.jobId)),
      ),
    );

    expect(JSON.parse(stored?.acknowledged_duplicates ?? "null")).toEqual([duplicateRef]);
  });

  test("publication check reports review blockers and rejects bad ids", async () => {
    const refused = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) => service.publicationCheck("not-a-number")),
    );

    expect(refused._tag).toBe("DishNotFound");
  });
});
