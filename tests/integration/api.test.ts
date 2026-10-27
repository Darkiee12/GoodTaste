import { beforeAll, describe, expect, test } from "bun:test";

import { z } from "zod";

import { createdSlugs } from "./cleanup";

const searchResultSchema = z.object({
  items: z.array(z.object({ slug: z.string() })),
  next_cursor: z.string().nullable(),
});

const errorSchema = z.object({
  error: z.object({ code: z.string() }),
});

const validationReportSchema = z.object({
  jobId: z.string(),
  validRecords: z.number(),
  invalidRecords: z.number(),
});

const applyReportSchema = z.object({ applied: z.number() });

const expectJson = async <Output>(
  response: Response,
  schema: z.ZodType<Output>,
): Promise<Output> => {
  const raw: unknown = await response.json();
  const parsed = schema.safeParse(raw);

  expect(parsed.success).toBe(true);

  if (!parsed.success) {
    throw new Error(`unexpected response shape: ${JSON.stringify(raw).slice(0, 300)}`);
  }

  return parsed.data;
};

import { type Effect } from "effect";

import {
  handleAdminCreateDish,
  handleAdminImportApply,
  handleAdminImportValidate,
  handleAdminReviewQueue,
  handleDishDetail,
  handleDishSearch,
  handleHealthLive,
  handleHealthReady,
} from "@/modules/food-discovery/server/api-adapter";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const api = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${path}`, init);

const adminHeaders = { "x-admin-key": "test-admin-key", "content-type": "application/json" };

describe("public HTTP", () => {
  test("health endpoints report live and ready", async () => {
    const live = await run(handleHealthLive(api("/health/live")));

    expect(live.status).toBe(200);

    const ready = await run(handleHealthReady(api("/health/ready")));

    expect(ready.status).toBe(200);
  });

  test("searches dishes with a stable envelope", async () => {
    const response = await run(handleDishSearch(api("/api/v1/dishes?q=pho&locale=en&limit=10")));
    const body = await expectJson(response, searchResultSchema);

    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.slug)).toContain("pho");

    const limited = response.headers.get("Cache-Control") ?? "";

    expect(limited.includes("max-age")).toBe(true);
  });

  test("rejects invalid query parameters with 400", async () => {
    const response = await run(handleDishSearch(api("/api/v1/dishes?limit=9999")));

    expect(response.status).toBe(400);
  });

  test("returns 404 for unknown dishes", async () => {
    const response = await run(
      handleDishDetail(api("/api/v1/dishes/no-such-dish"), { id: "no-such-dish" }),
    );

    const body = await expectJson(response, errorSchema);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});

describe("admin HTTP", () => {
  test("rejects unauthenticated writes with 401", async () => {
    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "draft",
            names: [{ language_tag: "en", name: "Nope", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(response.status).toBe(401);
  });

  test("creates, publishes, and inspects a dish through the full workflow", async () => {
    const slug = `test-http-${Date.now().toString(36)}`;
    createdSlugs.push(slug);

    const created = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "en", name: "Test Dish", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);

    const reviewQueue = await run(
      handleAdminReviewQueue(api("/api/v1/admin/review-queue", { headers: adminHeaders })),
    );

    expect(reviewQueue.status).toBe(200);
  });
});

describe("bulk import", () => {
  test("validates a staged import without applying", async () => {
    const slug = `test-import-${Date.now().toString(36)}`;
    createdSlugs.push(slug);

    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({
            source_name: "test-seed",
            records: [
              {
                slug,
                status: "review",
                names: [{ language_tag: "en", name: "Test Import Dish", name_kind: "localized" }],
                categories: ["soup"],
              },
            ],
          }),
        }),
      ),
    );

    const body = await expectJson(response, validationReportSchema);

    expect(response.status).toBe(202);
    expect(body.validRecords).toBe(1);
    expect(body.invalidRecords).toBe(0);

    const applied = await run(
      handleAdminImportApply(
        api("/api/v1/admin/imports/apply", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({ job_id: body.jobId }),
        }),
      ),
    );

    const appliedBody = await expectJson(applied, applyReportSchema);

    expect(applied.status).toBe(200);
    expect(appliedBody.applied).toBe(1);
  });

  test("rejects unknown ingredients without touching the catalog", async () => {
    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({
            source_name: "test-seed",
            records: [
              {
                names: [{ language_tag: "en", name: "Nope Dish", name_kind: "localized" }],
                ingredients: [{ name: "unobtainium", role: "core" }],
              },
            ],
          }),
        }),
      ),
    );

    const body = await expectJson(response, validationReportSchema);

    expect(body.validRecords).toBe(0);
    expect(body.invalidRecords).toBe(1);
  });
});

beforeAll(() => {
  expect(process.env.ADMIN_API_KEY).toBe("test-admin-key");
});
