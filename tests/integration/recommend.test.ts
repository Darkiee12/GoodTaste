import { describe, expect, test } from "bun:test";

import {
  buildRecommendPayload,
  parseCommaList,
  readSavedPrefs,
  recCountrySchema,
  recCuisineSchema,
  recMealSchema,
  recMoodSchema,
  REC_CUISINES,
  REC_MEALS,
  REC_MOODS,
  serializePrefs,
  termLengthError,
  tooLongTerms,
  validateRegion,
} from "@/routes/recommend";
import { messagesFor } from "@/shared/i18n";

const copy = messagesFor("en");

describe("recommend route client parsing", () => {
  test("meal and mood schemas mirror the server enums", () => {
    expect(recMealSchema.safeParse("lunch").success).toBe(true);
    expect(recMealSchema.safeParse("brunch").success).toBe(false);
    expect(recMoodSchema.safeParse("spicy").success).toBe(true);
    expect(recMoodSchema.safeParse("hangry").success).toBe(false);
    expect(REC_MEALS).toHaveLength(6);
    expect(REC_MOODS).toHaveLength(7);
  });

  test("cuisine allowlist matches the fixed studio list", () => {
    expect([...REC_CUISINES]).toEqual([
      "vietnamese",
      "japanese",
      "korean",
      "indian",
      "italian",
      "spanish",
      "mexican",
      "nigerian",
      "ethiopian",
      "levantine",
    ]);
    expect(recCuisineSchema.safeParse("french").success).toBe(false);
  });

  test("country schema mirrors the server ISO pattern", () => {
    expect(recCountrySchema.safeParse("VN").success).toBe(true);
    expect(recCountrySchema.safeParse("VN-01").success).toBe(true);
    expect(recCountrySchema.safeParse("vn").success).toBe(false);
    expect(recCountrySchema.safeParse("USA!").success).toBe(false);
  });

  test("comma lists trim, drop empties, and dedupe", () => {
    expect(parseCommaList("peanuts, shrimp ,peanuts,, ")).toEqual(["peanuts", "shrimp"]);
    expect(parseCommaList("  ")).toEqual([]);
  });

  test("overlong exclusion terms are rejected before the server call", () => {
    expect(tooLongTerms(["a".repeat(100)])).toBe(false);
    expect(tooLongTerms(["a".repeat(101)])).toBe(true);
    expect(termLengthError("cilantro", "peanuts", copy)).toBeNull();
    expect(termLengthError("a".repeat(101), "", copy)).toBe(copy.recTermTooLong);
  });

  test("region validation requires a real choice per lane", () => {
    expect(validateRegion("anywhere", "", "", copy)).toBeNull();
    expect(validateRegion("cuisine", "", "", copy)).toBe(copy.recCuisineError);
    expect(validateRegion("cuisine", "japanese", "", copy)).toBeNull();
    expect(validateRegion("country", "", "x1!", copy)).toBe(copy.recCountryError);
    expect(validateRegion("country", "", " vn ", copy)).toBeNull();
  });

  test("payload builder keeps undefined lanes undefined", () => {
    const payload = buildRecommendPayload({
      meal: "dinner",
      avoid: ["cilantro"],
      allergies: [],
      cuisine: undefined,
      country: "VN",
      mood: "comforting",
      locale: "en",
    });

    expect(payload.meal).toBe("dinner");
    expect(payload.cuisine).toBeUndefined();
    expect(payload.country).toBe("VN");
    expect(payload.avoid).toEqual(["cilantro"]);
  });

  test("stored prefs parse only with the consent flag and a known shape", () => {
    expect(readSavedPrefs(() => null)).toBeNull();
    expect(readSavedPrefs(() => "not json")).toBeNull();
    expect(readSavedPrefs(() => JSON.stringify({ remember: true, avoid: [1] }))).toBeNull();
    expect(
      readSavedPrefs(() => JSON.stringify({ remember: false, avoid: [], allergies: [] })),
    ).toBeNull();

    const saved = readSavedPrefs(() =>
      serializePrefs({ remember: true, avoid: ["x"], allergies: ["y"], cuisine: "indian" }),
    );

    expect(saved?.cuisine).toBe("indian");
    expect(saved?.country).toBeUndefined();
  });
});
