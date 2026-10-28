import { afterAll, describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { CatalogService } from "@/modules/food-discovery/server/operations/catalog-service";
import { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import { addFavoriteFn, listFavoritesFn, removeFavoriteFn } from "@/modules/user/profile.functions";
import { classifySessionFailure, sessionFailureSchema } from "@/modules/user/session.functions";
import type { SessionState } from "@/modules/user/session.functions";
import {
  buildSurprisePayload,
  draftFromSavedPrefs,
  EMPTY_DRAFT,
  readSavedPrefs,
} from "@/routes/recommend";
import { SignInRequired, UserSuspended } from "@/server/auth/errors";
import { resolveSession, requirePermission } from "@/server/auth/session";
import { DatabaseUnavailable } from "@/server/database/errors";
import type { AppServices } from "@/server/layers";
import { appRuntime, RequestTimeout } from "@/server/runtime";

import { createFoodAuth } from "./food-auth";
// oxlint-disable-next-line import/no-unassigned-import -- seeds disposable-DB and auth env guards at import time; this file owns no fixtures.
import "./cleanup";

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const flipRun = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

describe("guest journey: public catalog discovery", () => {
  test("empty-q search returns published dishes for homepage cards", async () => {
    const output = await run(
      Effect.flatMap(DishService, (service) => service.searchDishes({ locale: "en", limit: 5 })),
    );

    expect(output.items.length).toBeGreaterThan(0);

    for (const item of output.items) {
      expect(item.slug.length).toBeGreaterThan(0);
      expect(item.id).toMatch(/^[0-9]+$/);
    }
  });

  test("unknown dish id fails with a stable DishNotFound tag (no message sniffing)", async () => {
    const failure = await flipRun(
      Effect.flatMap(DishService, (service) => service.getDish("no-such-dish-000", "en")),
    );

    expect(failure._tag).toBe("DishNotFound");
  });

  test("place listing serves the country chooser without new SQL", async () => {
    const places = await run(
      Effect.flatMap(CatalogService, (service) => service.listPlaces("en", 100)),
    );

    const coded = places.filter((entry) => entry.iso3166 !== null);

    expect(coded.length).toBeGreaterThan(0);

    for (const entry of coded) {
      expect(entry.iso3166).toMatch(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/);
    }
  });

  test("batch summaries resolve many saved ids in one call, skipping unknown rows", async () => {
    const found = await run(
      Effect.flatMap(DishService, (service) => service.searchDishes({ locale: "en", limit: 3 })),
    );

    expect(found.items.length).toBeGreaterThan(0);

    const ids = found.items.map((item) => item.id);

    const summaries = await run(
      Effect.flatMap(DishService, (service) => service.getDishSummaries(ids, "en")),
    );

    expect(summaries.map((dish) => dish.id)).toEqual(ids);

    const partial = await run(
      Effect.flatMap(DishService, (service) =>
        service.getDishSummaries(
          [...ids.slice(0, 1), "999999999", "not-an-id", ...ids.slice(0, 1)],
          "en",
        ),
      ),
    );

    expect(partial.map((dish) => dish.id)).toEqual(ids.slice(0, 1));
  });
});

describe("guest journey: surprise keeps restrictions", () => {
  test("surprise payload preserves avoid, allergies, cuisine, and country", () => {
    const draft = {
      ...EMPTY_DRAFT,
      avoidRaw: "cilantro, mushrooms",
      allergiesRaw: "peanuts",
      regionMode: "country" as const,
      cuisine: "",
      country: "vn",
      remember: false,
    };

    const payload = buildSurprisePayload({
      draft,
      meal: "dinner",
      mood: "any",
      locale: "en",
      surpriseSeed: 0,
    });

    expect(payload.avoid).toEqual(["cilantro", "mushrooms"]);
    expect(payload.allergies).toEqual(["peanuts"]);
    expect(payload.country).toBe("VN");
    expect(payload.meal).toBe("dinner");
  });

  test("surprise payload preserves the catalog cuisine lane", () => {
    const draft = {
      ...EMPTY_DRAFT,
      regionMode: "cuisine" as const,
      cuisine: "vietnamese",
      country: "",
    };

    const payload = buildSurprisePayload({
      draft,
      meal: "lunch",
      mood: "surprise",
      locale: "vi",
      surpriseSeed: 1,
      cuisineSlugs: ["vietnamese", "japanese"],
    });

    expect(payload.cuisine).toBe("vietnamese");
    expect(payload.locale).toBe("vi");
  });

  test("saved prefs restore only exclusions and region, never meal or mood", () => {
    const saved = readSavedPrefs(() =>
      JSON.stringify({
        remember: true,
        avoid: ["cilantro"],
        allergies: ["shrimp"],
        country: "VN",
      }),
    );

    const draft = draftFromSavedPrefs(saved);

    expect(draft.avoidRaw).toBe("cilantro");
    expect(draft.allergiesRaw).toBe("shrimp");
    expect(draft.regionMode).toBe("country");
  });
});

const classified = (
  failure: DatabaseUnavailable | RequestTimeout | SignInRequired | UserSuspended | Error,
): SessionState => classifySessionFailure(sessionFailureSchema.safeParse(failure));

describe("guest journey: sessions and member-only mutations", () => {
  test("empty headers resolve to SignInRequired (signed-out, never member)", async () => {
    const failure = await flipRun(resolveSession(new Headers()));

    expect(failure._tag).toBe("SignInRequired");
    expect(classified(failure)).toEqual({ status: "signed-out" });
  });

  test("store outages classify as unavailable, auth failures as signed-out", () => {
    expect(classified(new DatabaseUnavailable({ operation: "test" }))).toEqual({
      status: "unavailable",
    });

    expect(classified(new RequestTimeout({ operation: "test" }))).toEqual({
      status: "unavailable",
    });

    expect(classified(new SignInRequired({ required: "member" }))).toEqual({
      status: "signed-out",
    });

    expect(classified(new UserSuspended({ reason: "test" }))).toEqual({ status: "signed-out" });

    // Unknown failures are infrastructure ambiguity, never proof of logout.
    expect(classified(new Error("boom"))).toEqual({ status: "unavailable" });
  });

  test("favorites gate allows members, denies guests (server-enforced)", async () => {
    const member = await foodAuth.signupSignin("guestjourney");

    await foodAuth.grantRole(member.userId, "member");

    const trusted = await run(
      requirePermission(new Headers({ cookie: member.cookies }), {
        resource: "favorite",
        actions: ["create"],
      }),
    );

    expect(trusted.userId).toBe(member.userId);

    const denied = await flipRun(
      requirePermission(new Headers(), { resource: "favorite", actions: ["create"] }),
    );

    expect(denied._tag).toBe("SignInRequired");
  });

  test("favorites mutations reject logged-out callers", async () => {
    const outcomes = await Promise.allSettled([
      listFavoritesFn({ data: { limit: 20 } }),
      addFavoriteFn({ data: { dish_id: "1" } }),
      removeFavoriteFn({ data: { dish_id: "1" } }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected", "rejected"]);
  });
});
