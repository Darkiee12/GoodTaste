import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";
import { z } from "zod";

import { MAX_IMPORT_FILE_BYTES } from "@/modules/food-discovery/admin.schema";
import {
  handleAdminCreateDish,
  handleAdminImportValidate,
  handleAdminUpdateDishStatus,
} from "@/modules/food-discovery/server/api-adapter";
import { requirePermission } from "@/server/auth/session";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createdSlugs } from "./cleanup";
import { createFoodAuth, sessionHeaders } from "./food-auth";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const api = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${path}`, init);

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const stamp = Date.now().toString(36);
const updateOnlyRoleId = `test-perm-update-only-${stamp}`;
const publishRoleId = `test-perm-publisher-${stamp}`;
const createdRoleIds: Array<string> = [updateOnlyRoleId, publishRoleId];

const ensureRole = async (roleId: string, grants: ReadonlyArray<string>): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.roles (id, slug, name) VALUES (${roleId}, ${roleId}, ${roleId}) ON CONFLICT DO NOTHING`;
  await Promise.all(
    grants.map(
      (key) =>
        sql`INSERT INTO feastjourney.role_permissions (role_id, permission_key) VALUES (${roleId}, ${key}) ON CONFLICT DO NOTHING`,
    ),
  );

  await sql.end();
};

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeTruthy();
  await ensureRole(updateOnlyRoleId, ["food:create", "food:update"]);
  await ensureRole(publishRoleId, ["food:create", "food:update", "food:publish"]);
});

afterAll(async () => {
  await Promise.all(
    createdRoleIds.map(async (roleId) => {
      const sql = new SQL(process.env.DATABASE_URL ?? "");

      await sql`DELETE FROM feastjourney.roles WHERE id = ${roleId}`;
      await sql.end();
    }),
  );
});

describe("admin status transitions require food:publish", () => {
  test("update-only actor is denied on a non-publish target (archived)", async () => {
    const editor = await foodAuth.signupSignin("perm-update-only");
    await foodAuth.grantRole(editor.userId, updateOnlyRoleId);

    const slug = `perm-status-${stamp}`;
    createdSlugs.push(slug);

    const created = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(editor.cookies),
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "en", name: "Status Matrix Dish", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);

    const createdBody = z.object({ id: z.string() }).parse(await created.json());

    const archived = await run(
      handleAdminUpdateDishStatus(
        api(`/api/v1/admin/dishes/${createdBody.id}/status`, {
          method: "PUT",
          headers: sessionHeaders(editor.cookies),
          body: JSON.stringify({ status: "archived" }),
        }),
        { id: createdBody.id },
      ),
    );

    expect(archived.status).toBe(403);

    const publishCheck = await runFailure(
      requirePermission(new Headers({ cookie: editor.cookies }), {
        resource: "food",
        actions: ["publish"],
      }),
    );

    expect(publishCheck._tag).toBe("InsufficientPermissions");

    const updateCheck = await run(
      requirePermission(new Headers({ cookie: editor.cookies }), {
        resource: "food",
        actions: ["update"],
      }),
    );

    expect(updateCheck.userId).toBe(editor.userId);
  });

  test("publisher actor passes the same publish check", async () => {
    const publisher = await foodAuth.signupSignin("perm-publisher");
    await foodAuth.grantRole(publisher.userId, publishRoleId);

    const trusted = await run(
      requirePermission(new Headers({ cookie: publisher.cookies }), {
        resource: "food",
        actions: ["publish"],
      }),
    );

    expect(trusted.userId).toBe(publisher.userId);

    const slug = `perm-publish-${stamp}`;
    createdSlugs.push(slug);

    const created = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: sessionHeaders(publisher.cookies),
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "en", name: "Publisher Dish", name_kind: "localized" }],
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);

    const createdBody = z.object({ id: z.string() }).parse(await created.json());

    const archived = await run(
      handleAdminUpdateDishStatus(
        api(`/api/v1/admin/dishes/${createdBody.id}/status`, {
          method: "PUT",
          headers: sessionHeaders(publisher.cookies),
          body: JSON.stringify({ status: "archived" }),
        }),
        { id: createdBody.id },
      ),
    );

    expect(archived.status).not.toBe(403);
    expect(archived.status).toBe(200);
  });
});

describe("import payloads fail closed on size", () => {
  test("byte length exceeds char length for multibyte text (P2 rationale)", () => {
    const multibyte = "é".repeat(9_000_000);

    expect(multibyte.length).toBeLessThan(MAX_IMPORT_FILE_BYTES);

    const byteLength = Buffer.byteLength(multibyte, "utf8");

    expect(byteLength).toBeGreaterThan(MAX_IMPORT_FILE_BYTES);

    const wouldReject = byteLength > MAX_IMPORT_FILE_BYTES;

    expect(wouldReject).toBe(true);
  });

  test("oversized records array fails closed through the validate handler", async () => {
    const importer = await foodAuth.signupSignin("perm-importer");
    await foodAuth.grantRole(importer.userId, "curator");

    const records = Array.from({ length: 101 }, (_, index) => ({
      names: [{ language_tag: "en", name: `Oversized Dish ${index}`, name_kind: "localized" }],
    }));

    const response = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: sessionHeaders(importer.cookies),
          body: JSON.stringify({ source_name: "oversized-probe", records }),
        }),
      ),
    );

    expect(response.status).not.toBe(202);

    const single = await run(
      handleAdminImportValidate(
        api("/api/v1/admin/imports/validate", {
          method: "POST",
          headers: sessionHeaders(importer.cookies),
          body: JSON.stringify({
            source_name: "sized-probe",
            records: [
              {
                names: [{ language_tag: "en", name: "Sized Probe Dish", name_kind: "localized" }],
                categories: ["soup"],
              },
            ],
          }),
        }),
      ),
    );

    expect(single.status).toBe(202);
  });
});
