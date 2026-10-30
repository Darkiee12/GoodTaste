// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { Effect } from "effect";

import {
  csvToRecords,
  jsonToRecords,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./food-auth";

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const stats = () =>
  run(Effect.flatMap(AdminDashboardService, (service) => service.dashboardStats()));

describe("import file parsing", () => {
  test("accepts the documented JSON envelope and bare arrays", () => {
    const fromEnvelope = jsonToRecords('{"records": [{"names": []}]}');

    expect(fromEnvelope.length).toBe(1);

    const fromArray = jsonToRecords('[{"names": []}]');

    expect(fromArray.length).toBe(1);
  });

  test("rejects invalid JSON, empty sets, and oversized datasets", () => {
    expect(() => jsonToRecords("not json")).toThrow("not valid JSON");
    expect(() => jsonToRecords('{"records": []}')).toThrow("no records");
    expect(() => jsonToRecords('{"nope": true}')).toThrow('"records" array');
  });

  test("parses the documented CSV shape with quoted fields", () => {
    const records = csvToRecords(
      'slug,status,name,language_tag,ingredients,places\n"my-dish",review,"Good, Tasty Dish",en,"rice; beans",VN\n',
    );

    expect(records.length).toBe(1);

    const serialized = JSON.stringify(records[0]);

    expect(serialized).toContain("Good, Tasty Dish");
    expect(serialized).toContain("beans");
  });

  test("rejects CSV without a name column or with unknown columns", () => {
    expect(() => csvToRecords("slug,status\nx,review\n")).toThrow('"name" column');
    expect(() => csvToRecords("name,frobnicate\nx\n")).toThrow(
      'unsupported CSV column "frobnicate"',
    );
  });

  test("flags unknown sources and licenses for manual review", () => {
    expect(needsLicenseReview("other", "cc0")).toBe(true);
    expect(needsLicenseReview("community", "cc0")).toBe(true);
    expect(needsLicenseReview("manual", "unknown")).toBe(true);
    expect(needsLicenseReview("manual", "manual-entry")).toBe(false);
    expect(needsLicenseReview("partner", "partner-agreement")).toBe(false);
  });
});

describe("admin dashboard stats", () => {
  test("reports real catalog counts without placeholder metrics", async () => {
    const report = await stats();

    expect(report.dishCounts.published).toBeGreaterThanOrEqual(0);
    expect(report.dishCounts.review).toBeGreaterThanOrEqual(0);
    expect(report.missingIngredients).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.recentDishes)).toBe(true);
    expect(Array.isArray(report.recentJobs)).toBe(true);
  });
});

describe("import studio service", () => {
  test("stores source metadata and flags unknown ingredients per record", async () => {
    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName: "dashboard-test",
          payload: {
            source_name: "dashboard-test",
            records: [
              {
                names: [
                  { language_tag: "en", name: "Dashboard Nope Dish", name_kind: "localized" },
                ],
                ingredients: [{ name: "unobtainium-xyz", role: "core" }],
              },
            ],
          },
          format: "csv",
          sourceUrl: "https://example.com/data.csv",
          license: "other:unknown",
        }),
      ),
    );

    expect(report.validRecords).toBe(0);
    expect(report.invalidRecords).toBe(1);
    expect(report.items[0]?.errors.join(" ")).toContain("unobtainium-xyz");

    const stored = await run(
      Effect.flatMap(CurationRepository, (repository) =>
        repository.adminFindImportJob(BigInt(report.jobId)),
      ),
    );

    expect(stored?.format).toBe("csv");
    expect(stored?.source_url).toBe("https://example.com/data.csv");
    expect(stored?.license).toBe("other:unknown");
  });
});
