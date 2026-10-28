import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type Effect } from "effect";
import { z } from "zod";

import {
  handleAdminCreateDish,
  handleAdminUpdateDish,
} from "@/modules/food-discovery/server/api-adapter";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createdSlugs } from "./cleanup";
import { createFoodAuth, sessionHeaders } from "./food-auth";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const api = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${path}`, init);

const createdSchema = z.object({ id: z.string(), slug: z.string() });

const errorSchema = z.object({
  error: z.object({ code: z.string() }),
});

const foodAuth = createFoodAuth();

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const slugFor = (suite: string, name: string): string => `cycle-${suite}-${name}-${stamp}`;

const curatorHeaders = async (): Promise<HeadersInit> => {
  const curator = await foodAuth.signupSignin("cycle-curator");
  await foodAuth.grantRole(curator.userId, "curator");

  return sessionHeaders(curator.cookies);
};

let headers: HeadersInit;

const createDish = async (slug: string, parentSlug?: string): Promise<{ id: string }> => {
  createdSlugs.push(slug);

  const names = [{ language_tag: "en", name: `Cycle ${slug}`, name_kind: "localized" }];

  const payload =
    parentSlug === undefined
      ? { slug, status: "draft", names }
      : { slug, status: "draft", parent_slug: parentSlug, names };

  const response = await run(
    handleAdminCreateDish(
      api("/api/v1/admin/dishes", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }),
    ),
  );

  expect(response.status).toBe(201);

  return createdSchema.parse(await response.json());
};

const updateParent = async (id: string, parentSlug: string): Promise<Response> =>
  run(
    handleAdminUpdateDish(
      api(`/api/v1/admin/dishes/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ parent_slug: parentSlug }),
      }),
      { id },
    ),
  );

const expectInvalidRequest = async (response: Response, status = 400): Promise<void> => {
  expect(response.status).toBe(status);

  const body = errorSchema.parse(await response.json());

  expect(body.error.code).toBe("invalid_request");
};

// Each link names the previously created dish as its parent, so links must
// be created strictly in order; recursion keeps the sequence without a loop.
const createChain = async (prefix: string, links: number): Promise<string> => {
  const first = slugFor(prefix, "d0");
  await createDish(first);

  const grow = async (parent: string, index: number): Promise<string> => {
    if (index > links) {
      return parent;
    }

    const next = slugFor(prefix, `d${index}`);
    await createDish(next, parent);

    return grow(next, index + 1);
  };

  return grow(first, 1);
};

describe("dish parent cycles", () => {
  test("rejects a dish being its own parent", async () => {
    const slug = slugFor("self", "a");
    const dish = await createDish(slug);

    const response = await updateParent(dish.id, slug);

    await expectInvalidRequest(response);
  });

  test("rejects a two-node parent cycle on the second write", async () => {
    const slugA = slugFor("two", "a");
    const slugB = slugFor("two", "b");
    const dishA = await createDish(slugA);
    await createDish(slugB, slugA);

    const response = await updateParent(dishA.id, slugB);

    await expectInvalidRequest(response);
  });

  test("rejects a three-node chain cycle", async () => {
    const slugA = slugFor("three", "a");
    const slugB = slugFor("three", "b");
    const slugC = slugFor("three", "c");
    const dishA = await createDish(slugA);
    await createDish(slugB, slugA);
    await createDish(slugC, slugB);

    const response = await updateParent(dishA.id, slugC);

    await expectInvalidRequest(response);
  });

  test("allows re-parenting that does not create a cycle", async () => {
    const slugA = slugFor("reparent", "a");
    const slugB = slugFor("reparent", "b");
    const slugC = slugFor("reparent", "c");
    const dishA = await createDish(slugA);
    await createDish(slugB, slugA);
    const dishC = await createDish(slugC, slugB);

    const response = await updateParent(dishC.id, slugA);

    expect(response.status).toBe(200);
    expect(dishA.id).toBeTruthy();
  });

  test("allows a diamond with two children sharing one parent", async () => {
    const slugP = slugFor("diamond", "p");
    await createDish(slugP);

    await createDish(slugFor("diamond", "left"), slugP);
    await createDish(slugFor("diamond", "right"), slugP);
  });

  test("accepts a parent chain under the depth bound", async () => {
    const parent = await createChain("shallow", 4);

    await createDish(slugFor("shallow", "leaf"), parent);
  });

  test("rejects a parent assignment past the depth bound", async () => {
    const parent = await createChain("deep", 25);

    createdSlugs.push(slugFor("deep", "leaf"));

    const response = await run(
      handleAdminCreateDish(
        api("/api/v1/admin/dishes", {
          method: "POST",
          headers,
          body: JSON.stringify({
            slug: slugFor("deep", "leaf"),
            status: "draft",
            parent_slug: parent,
            names: [
              {
                language_tag: "en",
                name: `Cycle ${slugFor("deep", "leaf")}`,
                name_kind: "localized",
              },
            ],
          }),
        }),
      ),
    );

    await expectInvalidRequest(response);
  });
});

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeTruthy();
  headers = await curatorHeaders();
});

afterAll(async () => {
  await foodAuth.close();

  if (createdSlugs.length === 0) {
    return;
  }

  const { Database } = await import("@/server/database/client");
  const { Effect } = await import("effect");

  await appRuntime.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;

      for (const slug of createdSlugs) {
        if (!slug.startsWith("cycle-")) {
          continue;
        }

        yield* Effect.tryPromise({
          try: () => db.sql`DELETE FROM feastjourney.dishes WHERE slug = ${slug}`,
          catch: () => new Error("cleanup failed"),
        });
      }
    }),
  );
});
