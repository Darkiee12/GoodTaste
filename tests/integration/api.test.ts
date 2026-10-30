import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { z } from "zod";

import { createdSlugs } from "./cleanup";
import { createFoodAuth, sessionHeaders } from "./food-auth";

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
  handleAdminUpdateDish,
  handleAdminUpdateDishStatus,
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

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

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

  test("the legacy admin key cannot bypass RBAC", async () => {
    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: {
            "x-admin-key": "test-admin-key",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            status: "draft",
            names: [{ language_tag: "en", name: "Nope", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(response.status).toBe(401);
  });

  test("rejects forged session cookies with 401", async () => {
    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders("better-auth.session_token=forged-token"),
          body: JSON.stringify({
            status: "draft",
            names: [{ language_tag: "en", name: "Nope", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(response.status).toBe(401);
  });

  test("denies members without catalog grants with 403", async () => {
    const member = await foodAuth.signupSignin("api-member");
    await foodAuth.grantRole(member.userId, "member");

    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(member.cookies),
          body: JSON.stringify({
            status: "draft",
            names: [{ language_tag: "en", name: "Nope", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(response.status).toBe(403);
  });

  test("denies suspended curators with 403", async () => {
    const curator = await foodAuth.signupSignin("api-suspended");
    await foodAuth.grantRole(curator.userId, "curator");
    await foodAuth.suspendUser(curator.userId);

    const response = await run(
      handleAdminReviewQueue(
        api("/api/v1/admin/review-queue", { headers: sessionHeaders(curator.cookies) }),
      ),
    );

    expect(response.status).toBe(403);
  });

  test("denies publication without food:publish while allowing updates", async () => {
    const sql = new SQL(process.env.DATABASE_URL ?? "");
    const roleId = `test-update-only-${Date.now().toString(36)}`;

    await sql`INSERT INTO feastjourney.roles (id, slug, name) VALUES (${roleId}, ${roleId}, 'Update only') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO feastjourney.role_permissions (role_id, permission_key) VALUES (${roleId}, 'food:create'), (${roleId}, 'food:update') ON CONFLICT DO NOTHING`;
    await sql.end();

    const editor = await foodAuth.signupSignin("api-editor");
    await foodAuth.grantRole(editor.userId, roleId);

    const slug = `test-http-${Date.now().toString(36)}`;
    createdSlugs.push(slug);

    const created = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(editor.cookies),
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "en", name: "Test Dish", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);

    const createdBody = z.object({ id: z.string() }).parse(await created.json());

    const renamed = await run(
      handleAdminUpdateDish(
        api(`/api/v1/admin/dishes/${createdBody.id}`, {
          method: "PUT",
          headers: sessionHeaders(editor.cookies),
          body: JSON.stringify({ slug: `${slug}-renamed` }),
        }),
        { id: createdBody.id },
      ),
    );

    expect(renamed.status).toBe(200);

    const publishDenied = await run(
      handleAdminUpdateDishStatus(
        api(`/api/v1/admin/dishes/${createdBody.id}/status`, {
          method: "PUT",
          headers: sessionHeaders(editor.cookies),
          body: JSON.stringify({ status: "published" }),
        }),
        { id: createdBody.id },
      ),
    );

    expect(publishDenied.status).toBe(403);

    const cleanup = new SQL(process.env.DATABASE_URL ?? "");
    await cleanup`DELETE FROM feastjourney.roles WHERE id = ${roleId}`;
    await cleanup.end();
  });

  test("curators create dishes; revoked roles lose access immediately", async () => {
    const curator = await foodAuth.signupSignin("api-curator");
    await foodAuth.grantRole(curator.userId, "curator");

    const slug = `test-http-${Date.now().toString(36)}`;
    createdSlugs.push(slug);

    const created = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(curator.cookies),
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "en", name: "Test Dish", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);

    const moderator = await foodAuth.signupSignin("api-moderator");
    await foodAuth.grantRole(moderator.userId, "moderator");

    const reviewQueue = await run(
      handleAdminReviewQueue(
        api("/api/v1/admin/review-queue", { headers: sessionHeaders(moderator.cookies) }),
      ),
    );

    expect(reviewQueue.status).toBe(200);

    const curatorQueue = await run(
      handleAdminReviewQueue(
        api("/api/v1/admin/review-queue", { headers: sessionHeaders(curator.cookies) }),
      ),
    );

    expect(curatorQueue.status).toBe(403);

    await foodAuth.revokeRole(curator.userId, "curator");

    const afterRevoke = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(curator.cookies),
          body: JSON.stringify({
            status: "draft",
            names: [{ language_tag: "en", name: "Nope", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(afterRevoke.status).toBe(403);
  });
});

describe("bulk import", () => {
  test("validates a staged import without applying", async () => {
    const importer = await foodAuth.signupSignin("api-importer");
    await foodAuth.grantRole(importer.userId, "curator");

    const slug = `test-import-${Date.now().toString(36)}`;
    createdSlugs.push(slug);

    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: sessionHeaders(importer.cookies),
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
          headers: sessionHeaders(importer.cookies),
          body: JSON.stringify({
            job_id: body.jobId,
            approvals: { license_ack: true, review_ack: true, duplicate_refs: [] },
          }),
        }),
      ),
    );

    const appliedBody = await expectJson(applied, applyReportSchema);

    expect(applied.status).toBe(200);
    expect(appliedBody.applied).toBe(1);
  });

  test("rejects unknown ingredients without touching the catalog", async () => {
    const importer = await foodAuth.signupSignin("api-importer-bad");
    await foodAuth.grantRole(importer.userId, "curator");

    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: sessionHeaders(importer.cookies),
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

  test("denies import validate/apply without food:import", async () => {
    const member = await foodAuth.signupSignin("api-import-member");
    await foodAuth.grantRole(member.userId, "member");

    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: sessionHeaders(member.cookies),
          body: JSON.stringify({
            source_name: "test-seed",
            records: [],
          }),
        }),
      ),
    );

    expect(response.status).toBe(403);
  });
});

beforeAll(() => {
  expect(process.env.DATABASE_URL).toBeTruthy();
});
