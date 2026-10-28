import { describe, expect, test } from "bun:test";

import {
  MEAL_OCCASIONS,
  RECOMMENDATION_MOODS,
} from "@/modules/food-discovery/server/domain/recommendation";
import { REC_MEALS, REC_MOODS } from "@/routes/recommend";

/**
 * The chooser UI duplicates the server's finite vocabularies as local const
 * enums (transport must stay browser-safe and cannot import server modules).
 * This test pins the two sides together so a new meal or mood on either
 * side fails loudly instead of silently filtering everything out.
 */
describe("recommendation vocabulary parity", () => {
  test("client meal options match the server domain union", () => {
    expect([...REC_MEALS]).toEqual([...MEAL_OCCASIONS]);
  });

  test("client mood options match the server domain union", () => {
    expect([...REC_MOODS]).toEqual([...RECOMMENDATION_MOODS]);
  });
});
