import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Effect } from "effect";
import { z } from "zod";

import {
  handleAdminAddDishName,
  handleAdminAddNote,
  handleAdminCreateDish,
  handleAdminLinkDishCategory,
  handleAdminListNotes,
  handleAdminListRevisions,
  handleAdminReviewQueue,
  handleAdminUpdateDish,
  handleAdminUpsertDishDescription,
} from "@/modules/food-discovery/server/api-adapter";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createdSlugs } from "./cleanup";
import { createFoodAuth, sessionHeaders } from "./food-auth";

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const api = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${path}`, init);

let curator: Record<string, string> = {};
let moderator: Record<string, string> = {};

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeTruthy();

  const curatorSession = await foodAuth.signupSignin("curation-curator");
  await foodAuth.grantRole(curatorSession.userId, "curator");
  curator = sessionHeaders(curatorSession.cookies);

  const moderatorSession = await foodAuth.signupSignin("curation-moderator");
  await foodAuth.grantRole(moderatorSession.userId, "moderator");
  moderator = sessionHeaders(moderatorSession.cookies);
});

const idSchema = z.object({ id: z.string(), slug: z.string().optional() });

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

describe("curated authoring workflow", () => {
  const slug = `test-curation-${Date.now().toString(36)}`;
  let dishId = "";

  test("creates drafts without an English name", async () => {
    createdSlugs.push(slug);

    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers: curator,
          body: JSON.stringify({
            slug,
            status: "draft",
            names: [{ language_tag: "vi", name: "Món Thử", name_kind: "native" }],
          }),
        }),
      ),
    );

    const body = await expectJson(response, idSchema);

    expect(response.status).toBe(201);
    dishId = body.id;
  });

  test("blocks publication until the catalog policy is satisfied", async () => {
    const response = await run(
      handleAdminUpdateDish(
        api(`/api/v1/admin/dishes/${dishId}`, {
          method: "PUT",
          headers: curator,
          body: JSON.stringify({ status: "published" }),
        }),
        { id: dishId },
      ),
    );

    expect(response.status).toBe(400);
  });

  test("publishes once requirements are met and records revisions", async () => {
    const name = await run(
      handleAdminAddDishName(
        api(`/api/v1/admin/dishes/${dishId}/names`, {
          method: "POST",
          headers: curator,
          body: JSON.stringify({
            language_tag: "en",
            name: "Test Dish",
            name_kind: "localized",
          }),
        }),
        { id: dishId },
      ),
    );

    expect(name.status).toBe(201);

    const category = await run(
      handleAdminLinkDishCategory(
        api(`/api/v1/admin/dishes/${dishId}/categories`, {
          method: "POST",
          headers: curator,
          body: JSON.stringify({ category_slug: "soup" }),
        }),
        { id: dishId },
      ),
    );

    expect(category.status).toBe(200);

    const description = await run(
      handleAdminUpsertDishDescription(
        api(`/api/v1/admin/dishes/${dishId}/description`, {
          method: "PUT",
          headers: curator,
          body: JSON.stringify({
            language_tag: "en",
            description: "A test dish used to verify the publication workflow.",
            summary: null,
          }),
        }),
        { id: dishId },
      ),
    );

    expect(description.status).toBe(200);

    const published = await run(
      handleAdminUpdateDish(
        api(`/api/v1/admin/dishes/${dishId}`, {
          method: "PUT",
          headers: curator,
          body: JSON.stringify({ status: "published" }),
        }),
        { id: dishId },
      ),
    );

    expect(published.status).toBe(200);

    const revisions = await run(
      handleAdminListRevisions(
        api(`/api/v1/admin/dishes/${dishId}/revisions`, { headers: curator }),
        { id: dishId },
      ),
    );

    const revisionBody = await expectJson(
      revisions,
      z.object({ items: z.array(z.object({ operation: z.string() })) }),
    );

    const operations = revisionBody.items.map((entry) => entry.operation);

    expect(revisions.status).toBe(200);
    expect(operations).toContain("created");
    expect(operations).toContain("status_changed");
  });

  test("stores and lists curation notes", async () => {
    const noted = await run(
      handleAdminReviewQueue(api("/api/v1/admin/review-queue?limit=5", { headers: moderator })),
    );

    expect(noted.status).toBe(200);
  });
});

describe("curation notes", () => {
  test("notes round-trip through the admin API", async () => {
    const response = await run(
      handleAdminAddNote(
        api("/api/v1/admin/dishes/1/notes", {
          method: "POST",
          headers: curator,
          body: JSON.stringify({
            author: "test-curator",
            note_kind: "review",
            note: "Verify native name spelling with a second source.",
          }),
        }),
        { id: "1" },
      ),
    );

    expect(response.status).toBe(201);

    const listed = await run(
      handleAdminListNotes(api("/api/v1/admin/dishes/1/notes", { headers: curator }), {
        id: "1",
      }),
    );

    expect(listed.status).toBe(200);
  });
});
