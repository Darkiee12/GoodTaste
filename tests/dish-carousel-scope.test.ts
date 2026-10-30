import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { carouselQuerySchema } from "@/modules/food-discovery/food.schema";
import { InvalidSearchFilter } from "@/modules/food-discovery/server/domain/errors";
import {
  CarouselScope,
  carouselScopeName,
  resolveCarouselScope,
} from "@/modules/food-discovery/server/operations/dish-service";

/**
 * Carousel scope contract: exactly one of country | nearby(lat/lon) |
 * worldwide per call, with the full fallback chain owned by the service.
 * Pure unit coverage — no database: the resolver and the wire schema never
 * touch a pool, so scope exclusivity and the no-coordinate-leak regression
 * stay green without fixtures.
 */

type ScopeInput = Parameters<typeof resolveCarouselScope>[0];

const resolve = (input: ScopeInput) => Effect.runPromise(resolveCarouselScope(input));

const resolveFailure = (input: ScopeInput) =>
  Effect.runPromise(Effect.flip(resolveCarouselScope(input)));

describe("carousel scope resolution", () => {
  test("paired coordinates resolve to nearby with no country hint", async () => {
    const scope = await resolve({ latitude: 21.0, longitude: 105.8 });

    expect(scope?._tag).toBe("Nearby");

    if (scope?._tag === "Nearby") {
      expect(scope.latitude).toBe(21.0);
      expect(scope.longitude).toBe(105.8);
      expect(scope.country).toBeNull();
    }

    expect(scope === null ? null : carouselScopeName(scope)).toBe("nearby");
  });

  test("nearby keeps the optional country hint for the fallback pool", async () => {
    const scope = await resolve({ country: "VN", latitude: 21.0, longitude: 105.8 });

    expect(scope?._tag).toBe("Nearby");

    if (scope?._tag === "Nearby") {
      expect(scope.country).toBe("VN");
    }
  });

  test("country alone resolves to the country scope", async () => {
    const scope = await resolve({ country: "VN" });

    expect(scope?._tag).toBe("Country");

    if (scope !== null) {
      expect(carouselScopeName(scope)).toBe("country");
    }
  });

  test("worldwide alone resolves to the worldwide scope", async () => {
    const scope = await resolve({ worldwide: true });

    expect(scope?._tag).toBe("Worldwide");

    if (scope !== null) {
      expect(carouselScopeName(scope)).toBe("worldwide");
    }
  });

  test("explicit worldwide false is not a scope", async () => {
    const scope = await resolve({ country: "VN", worldwide: false });

    expect(scope?._tag).toBe("Country");
  });

  test("legacy empty input resolves to null for the honest-empty path", async () => {
    const scope = await resolve({});

    expect(scope).toBeNull();
  });

  test("boundary coordinates are accepted", async () => {
    const scopes = await Promise.all(
      [
        { latitude: 90, longitude: 180 },
        { latitude: -90, longitude: -180 },
        { latitude: 90, longitude: -180 },
        { latitude: -90, longitude: 180 },
      ].map((input) => resolve(input)),
    );

    for (const scope of scopes) {
      expect(scope?._tag).toBe("Nearby");
    }
  });
});

describe("carousel scope exclusivity", () => {
  test("worldwide with coordinates fails closed instead of running a precise search", async () => {
    const failure = await resolveFailure({ latitude: 21.0, longitude: 105.8, worldwide: true });

    expect(failure).toBeInstanceOf(InvalidSearchFilter);
  });

  test("worldwide with a country fails closed", async () => {
    const failure = await resolveFailure({ country: "VN", worldwide: true });

    expect(failure).toBeInstanceOf(InvalidSearchFilter);
  });

  test("partial coordinates fail closed in either direction", async () => {
    const failures = await Promise.all(
      [{ latitude: 21.0 }, { longitude: 105.8 }].map((input) => resolveFailure(input)),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidSearchFilter);
    }
  });

  test("out-of-range and non-finite coordinates fail closed", async () => {
    const failures = await Promise.all(
      [
        { latitude: 90.1, longitude: 0 },
        { latitude: -90.1, longitude: 0 },
        { latitude: 0, longitude: 180.1 },
        { latitude: 0, longitude: -180.1 },
        { latitude: Number.NaN, longitude: 0 },
        { latitude: 0, longitude: Number.POSITIVE_INFINITY },
      ].map((input) => resolveFailure(input)),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidSearchFilter);
    }
  });

  test("malformed country fails closed alone and as a nearby hint", async () => {
    const failures = await Promise.all(
      [{ country: "usa" }, { country: "usa", latitude: 21.0, longitude: 105.8 }].map((input) =>
        resolveFailure(input),
      ),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidSearchFilter);
    }
  });
});

describe("carousel query schema", () => {
  test("accepts each scope shape, including nearby with a country hint", () => {
    for (const data of [
      { country: "VN" },
      { latitude: 21.0, longitude: 105.8 },
      { country: "VN", latitude: 21.0, longitude: 105.8 },
      { worldwide: true },
    ]) {
      expect(carouselQuerySchema.safeParse(data).success).toBe(true);
    }
  });

  test("fills locale, limit, and seed defaults", () => {
    const parsed = carouselQuerySchema.safeParse({ country: "VN" });

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.locale).toBe("en");
      expect(parsed.data.limit).toBe(5);
      expect(parsed.data.seed).toBe(0);
    }
  });

  test("rejects worldwide carrying coordinates or country", () => {
    for (const data of [
      { latitude: 21.0, longitude: 105.8, worldwide: true },
      { country: "VN", worldwide: true },
    ]) {
      expect(carouselQuerySchema.safeParse(data).success).toBe(false);
    }
  });

  test("rejects partial coordinates, empty scope, and out-of-range values", () => {
    for (const data of [{ latitude: 21.0 }, {}, { latitude: 91, longitude: 0 }]) {
      expect(carouselQuerySchema.safeParse(data).success).toBe(false);
    }
  });
});

describe("carousel scope names", () => {
  test("every variant maps to its coarse label", () => {
    expect(
      carouselScopeName(CarouselScope.Nearby({ country: null, latitude: 0, longitude: 0 })),
    ).toBe("nearby");
    expect(carouselScopeName(CarouselScope.Country({ country: "VN" }))).toBe("country");
    expect(carouselScopeName(CarouselScope.Worldwide())).toBe("worldwide");
  });
});
