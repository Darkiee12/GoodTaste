import { describe, expect, test } from "bun:test";

import { windowForSurprise } from "@/modules/food-discovery/server/domain/surprise-window";

const pool = (count: number): Array<string> =>
  Array.from({ length: count }, (_, index) => `dish-${index + 1}`);

describe("surprise window", () => {
  test("seed zero keeps the stable head", () => {
    expect(windowForSurprise(pool(12), 0, 5)).toEqual([
      "dish-1",
      "dish-2",
      "dish-3",
      "dish-4",
      "dish-5",
    ]);
  });

  test("nonzero seed offsets into the pool and introduces new dishes", () => {
    const varied = windowForSurprise(pool(12), 1, 5);

    expect(varied).toEqual(["dish-2", "dish-3", "dish-4", "dish-5", "dish-6"]);
    expect(varied).not.toContain("dish-1");
    expect(varied).toContain("dish-6");
  });

  test("count below the output limit returns the whole pool", () => {
    expect(windowForSurprise(pool(3), 7, 5)).toEqual(["dish-1", "dish-2", "dish-3"]);
  });

  test("count equal to the output limit returns the whole pool", () => {
    expect(windowForSurprise(pool(5), 7, 5)).toEqual([
      "dish-1",
      "dish-2",
      "dish-3",
      "dish-4",
      "dish-5",
    ]);
  });

  test("count above the limit wraps around the pool end", () => {
    expect(windowForSurprise(pool(12), 10, 5)).toEqual([
      "dish-11",
      "dish-12",
      "dish-1",
      "dish-2",
      "dish-3",
    ]);
  });

  test("large seeds reduce modulo the pool size", () => {
    expect(windowForSurprise(pool(12), 2147483647, 5)).toEqual(
      windowForSurprise(pool(12), 2147483647 % 12, 5),
    );
  });

  test("repeated seeds reproduce the same window", () => {
    expect(windowForSurprise(pool(12), 4, 5)).toEqual(windowForSurprise(pool(12), 4, 5));
  });

  test("windows never duplicate or drop eligible dishes", () => {
    for (const seed of [0, 1, 2, 11, 12, 13, 100]) {
      const windowed = windowForSurprise(pool(12), seed, 5);

      expect(windowed).toHaveLength(5);
      expect(new Set(windowed).size).toBe(5);
    }
  });

  test("empty pool stays empty", () => {
    expect(windowForSurprise([], 3, 5)).toEqual([]);
  });
});
