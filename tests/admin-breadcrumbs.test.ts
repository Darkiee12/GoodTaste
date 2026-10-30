import { describe, expect, test } from "bun:test";

import {
  dishDetailReturnSchema,
  dishReturnStatusSchema,
  resolveDishesBackSearch,
} from "@/components/admin/page-header";

/**
 * Breadcrumb context preservation. Pure unit tests over the resolvers in
 * components/admin/page-header — no DB, no server, no DOM.
 */

describe("dishReturnStatusSchema", () => {
  test("accepts the four dishes-list statuses", () => {
    for (const status of ["draft", "review", "published", "archived"] as const) {
      expect(dishReturnStatusSchema.parse(status)).toBe(status);
    }
  });

  test("rejects unknown statuses so the breadcrumb cannot echo junk", () => {
    expect(dishReturnStatusSchema.safeParse("deleted").success).toBe(false);
    expect(dishReturnStatusSchema.safeParse("").success).toBe(false);
  });
});

describe("dishDetailReturnSchema", () => {
  test("accepts an empty return destination (deep link)", () => {
    expect(dishDetailReturnSchema.parse({})).toEqual({});
  });

  test("accepts a full return destination from the dishes list", () => {
    expect(dishDetailReturnSchema.parse({ fromStatus: "published", fromCursor: "42" })).toEqual({
      fromStatus: "published",
      fromCursor: "42",
    });
  });

  test("rejects an invalid return status", () => {
    expect(
      dishDetailReturnSchema.safeParse({ fromStatus: "deleted", fromCursor: "0" }).success,
    ).toBe(false);
  });
});

describe("resolveDishesBackSearch", () => {
  test("preserves the caller's status filter, cursor, and lang", () => {
    expect(
      resolveDishesBackSearch({ lang: "vi", fromStatus: "published", fromCursor: "42" }),
    ).toEqual({ lang: "vi", status: "published", cursor: "42" });
  });

  test("falls back to the canonical parent for deep links", () => {
    expect(resolveDishesBackSearch({ lang: "en" })).toEqual({
      lang: "en",
      status: "review",
      cursor: "0",
    });
  });

  test("treats an empty cursor as missing", () => {
    expect(resolveDishesBackSearch({ lang: "en", fromStatus: "draft", fromCursor: "" })).toEqual({
      lang: "en",
      status: "draft",
      cursor: "0",
    });
  });
});
