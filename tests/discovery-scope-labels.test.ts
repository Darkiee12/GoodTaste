import { describe, expect, test } from "bun:test";

import { sanitizeCountryCode } from "@/components/home/recommend/quiz-model";
import {
  accuracyLabelFor,
  classifyGeoError,
  fallbackOptionsFor,
  isPoorAccuracy,
  type PreciseStatus,
} from "@/components/home/recommend/use-precise-location";
import { carouselQuerySchema } from "@/modules/food-discovery/food.schema";
import {
  NEARBY_MAX_M,
  NEARBY_START_M,
  nearbyRadiiM,
} from "@/modules/food-discovery/server/operations/dish-service";
import { messagesFor } from "@/shared/i18n";

/**
 * Served-scope labeling + no-duplicate-action unit coverage for discovery.
 *
 * The homepage discovery section words its scope line from the scope
 * actually served (`nearby` | `country` | `worldwide`), never from the scope
 * asked for. These tests pin the copy contract behind that line (every
 * served scope owns a distinct, honest, translated label) and pin the
 * fallback-action contract (precise-location failure offers each alternative
 * exactly once, with at most one retry action).
 *
 * Pure unit coverage: no database, no network.
 */

const ALL_STATUSES: ReadonlyArray<PreciseStatus> = [
  "idle",
  "locating",
  "success",
  "denied",
  "timeout",
  "unavailable",
  "unsupported",
  "insecure",
];

describe("served-scope labels", () => {
  test("every served scope owns a distinct honest line in English and Vietnamese", () => {
    for (const locale of ["en", "vi"] as const) {
      const copy = messagesFor(locale);

      const worldwide = copy.carouselWorldwide;
      const precise = copy.discoverLocalNearYou;
      const network = copy.discoverLocalNear;
      const unknown = copy.discoverLocalUnknown;
      const empty = copy.carouselRegionEmpty;
      const exploreWorld = copy.carouselExploreWorld;

      for (const [key, value] of Object.entries({
        carouselWorldwide: worldwide,
        discoverLocalNearYou: precise,
        discoverLocalNear: network,
        discoverLocalUnknown: unknown,
        carouselRegionEmpty: empty,
        carouselExploreWorld: exploreWorld,
      })) {
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }

      // Honest labeling: nearby, network-area, worldwide, and unknown lines
      // must all read differently — a precise fallback relabeled as
      // "near you" would be invisible here otherwise.
      const lines = new Set([worldwide, precise, network, unknown]);

      expect(lines.size).toBe(4);
    }
  });

  test("worldwide and empty-state lines never mention local proximity", () => {
    const copy = messagesFor("en");

    expect(copy.carouselWorldwide).not.toMatch(/near you/i);
    expect(copy.carouselWorldwide).not.toMatch(/network area/i);
    expect(copy.carouselRegionEmpty).not.toMatch(/near you/i);
    expect(copy.discoverLocalUnknown).not.toMatch(/near you/i);
  });

  test("precise scope line supports the poor-accuracy qualifier without duplication", () => {
    const copy = messagesFor("en");

    expect(copy.discoverLocalNearYou.length).toBeGreaterThan(0);

    const qualified = `${copy.discoverLocalNearYou} (${accuracyLabelFor({ latitude: 0, longitude: 0, accuracy: 1500 }) ?? ""})`;

    expect(qualified).toContain(copy.discoverLocalNearYou);
    expect(accuracyLabelFor({ latitude: 0, longitude: 0, accuracy: 1500 })).not.toBeNull();
  });
});

describe("no-duplicate fallback actions", () => {
  test("every precise status offers each alternative at most once", () => {
    for (const status of ALL_STATUSES) {
      for (const detected of ["VN", null]) {
        const options = fallbackOptionsFor(status, detected);
        const choices = options.map((option) => option.choice);

        expect(new Set(choices).size, `${status}/detected=${detected}`).toBe(choices.length);
      }
    }
  });

  test("destination and worldwide are always offered exactly once", () => {
    for (const status of ALL_STATUSES) {
      const options = fallbackOptionsFor(status, "VN");
      const choices = options.map((option) => option.choice);

      expect(choices.filter((choice) => choice === "destination")).toHaveLength(1);
      expect(choices.filter((choice) => choice === "worldwide")).toHaveLength(1);
    }
  });

  test("at most one retry action exists, only for transient failures", () => {
    const transient: ReadonlyArray<PreciseStatus> = ["denied", "timeout", "unavailable"];

    const terminal: ReadonlyArray<PreciseStatus> = [
      "idle",
      "locating",
      "success",
      "unsupported",
      "insecure",
    ];

    for (const status of transient) {
      const retries = fallbackOptionsFor(status, null).filter((option) => option.retryPrecise);

      expect(retries, status).toHaveLength(1);
      expect(retries[0]?.choice).toBe("precise");
    }

    for (const status of terminal) {
      expect(
        fallbackOptionsFor(status, null).filter((option) => option.retryPrecise),
        status,
      ).toHaveLength(0);
    }
  });

  test("home-region action appears only when a region was detected, exactly once", () => {
    for (const status of ALL_STATUSES) {
      const withHome = fallbackOptionsFor(status, "VN").filter(
        (option) => option.choice === "home",
      );

      const withoutHome = fallbackOptionsFor(status, null).filter(
        (option) => option.choice === "home",
      );

      expect(withHome, status).toHaveLength(1);
      expect(withoutHome, status).toHaveLength(0);
    }
  });
});

describe("trusted-country normalization (discovery heading input)", () => {
  test("normalizes messy detection values to uppercase ISO codes", () => {
    expect(sanitizeCountryCode("vn")).toBe("VN");
    expect(sanitizeCountryCode(" VN ")).toBe("VN");
    expect(sanitizeCountryCode("vn-01")).toBe("VN-01");
  });

  test("rejects non-ISO values to null instead of leaking them into queries", () => {
    expect(sanitizeCountryCode("")).toBeNull();
    expect(sanitizeCountryCode("usa")).toBeNull();
    expect(sanitizeCountryCode("U")).toBeNull();
    expect(sanitizeCountryCode("XX-TOOLONG")).toBeNull();
    expect(sanitizeCountryCode("12")).toBeNull();
  });
});

describe("carousel query schema (exactly-one-scope wire contract)", () => {
  test("defaults to a five-card stable rotation on a worldwide request", () => {
    const parsed = carouselQuerySchema.parse({ locale: "en", worldwide: true });

    expect(parsed.limit).toBe(5);
    expect(parsed.seed).toBe(0);
    expect(parsed.worldwide).toBe(true);
    expect(parsed.country).toBeUndefined();
  });

  test("rejects malformed countries and out-of-range coordinates at the boundary", () => {
    expect(
      carouselQuerySchema.safeParse({ locale: "en", country: "usa", worldwide: true }).success,
    ).toBe(false);
    expect(
      carouselQuerySchema.safeParse({ locale: "en", latitude: 90.1, longitude: 0 }).success,
    ).toBe(false);
    expect(
      carouselQuerySchema.safeParse({ locale: "en", latitude: 0, longitude: -180.1 }).success,
    ).toBe(false);
  });

  test("accepts boundary coordinates and well-formed country codes", () => {
    expect(
      carouselQuerySchema.safeParse({ locale: "en", latitude: 90, longitude: 180 }).success,
    ).toBe(true);
    expect(carouselQuerySchema.safeParse({ locale: "en", country: "VN" }).success).toBe(true);
    expect(carouselQuerySchema.safeParse({ locale: "en", country: "VN-01" }).success).toBe(true);
  });

  test("worldwide must not carry coordinates or country (S12 wire layer)", () => {
    expect(
      carouselQuerySchema.safeParse({
        locale: "en",
        worldwide: true,
        latitude: -35,
        longitude: -35,
      }).success,
    ).toBe(false);
    expect(
      carouselQuerySchema.safeParse({ locale: "en", worldwide: true, country: "VN" }).success,
    ).toBe(false);
    expect(carouselQuerySchema.safeParse({ locale: "en", worldwide: true }).success).toBe(true);
  });

  test("partial coordinates and scope-less calls are rejected", () => {
    expect(carouselQuerySchema.safeParse({ locale: "en", latitude: 10 }).success).toBe(false);
    expect(carouselQuerySchema.safeParse({ locale: "en", longitude: 10 }).success).toBe(false);
    expect(carouselQuerySchema.safeParse({ locale: "en" }).success).toBe(false);
  });
});

describe("bounded nearby search (never an unbounded worldwide scan)", () => {
  test("radius schedule starts metro-scale and caps at the documented maximum", () => {
    expect(NEARBY_START_M).toBe(50_000);
    expect(NEARBY_MAX_M).toBe(500_000);

    const radii = nearbyRadiiM();

    expect(radii[0]).toBe(NEARBY_START_M);
    expect(radii[radii.length - 1]).toBe(NEARBY_MAX_M);
    expect(radii).toEqual([50_000, 200_000, 500_000]);

    for (const radius of radii) {
      expect(radius).toBeLessThanOrEqual(NEARBY_MAX_M);
    }
  });
});

describe("precise locator error mapping", () => {
  test("maps platform codes to locator statuses without throwing", () => {
    expect(classifyGeoError(1)).toBe("denied");
    expect(classifyGeoError(2)).toBe("unavailable");
    expect(classifyGeoError(3)).toBe("timeout");
    expect(classifyGeoError(99)).toBe("timeout");
  });

  test("poor-accuracy flag fires only past the documented threshold", () => {
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracy: null })).toBe(false);
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracy: 1000 })).toBe(false);
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracy: 1001 })).toBe(true);
    expect(accuracyLabelFor({ latitude: 0, longitude: 0, accuracy: null })).toBeNull();
  });
});
