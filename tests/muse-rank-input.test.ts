import { describe, expect, test } from "bun:test";

import {
  MUSE_RANK_INPUT_LIMIT,
  museRankInput,
} from "@/modules/food-discovery/server/operations/recommendation-service";

/**
 * Provider input bound: Muse re-ranks the first 10 deterministic
 * candidates, never the whole candidate pool. Pure unit coverage — no
 * database, no provider calls.
 */

const rows = (count: number): Array<{ readonly id: string }> =>
  Array.from({ length: count }, (_, index) => ({ id: `${index + 1}` }));

describe("museRankInput", () => {
  test("passes small pools through untouched", () => {
    expect(museRankInput(rows(3))).toHaveLength(3);
    expect(museRankInput(rows(10))).toHaveLength(10);
  });

  test("caps a large pool at ten, keeping head order", () => {
    const input = museRankInput(rows(30));

    expect(input).toHaveLength(MUSE_RANK_INPUT_LIMIT);
    expect(MUSE_RANK_INPUT_LIMIT).toBe(10);
    expect(input.map((row) => row.id)).toEqual(rows(MUSE_RANK_INPUT_LIMIT).map((row) => row.id));
  });

  test("empty pool stays empty", () => {
    expect(museRankInput([])).toEqual([]);
  });
});
