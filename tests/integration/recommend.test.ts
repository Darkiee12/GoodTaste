import { describe, expect, test } from "bun:test";

import {
  MEAL_OCCASIONS,
  RECOMMENDATION_MOODS,
} from "@/modules/food-discovery/recommendation.constants";
import {
  buildRecommendPayload,
  buildSurprisePayload,
  draftFromSavedPrefs,
  EMPTY_DRAFT,
  mealSchema,
  moodSchema,
  parseCommaList,
  readSavedPrefs,
  recCountrySchema,
  removeSavedPrefs,
  serializePrefs,
  termLengthError,
  tooLongTerms,
  validateRegion,
} from "@/routes/recommend";
import { messagesFor } from "@/shared/i18n";

const copy = messagesFor("en");

describe("recommend route client parsing", () => {
  test("meal and mood schemas mirror the shared vocabularies", () => {
    expect(mealSchema.safeParse("lunch").success).toBe(true);
    expect(mealSchema.safeParse("brunch").success).toBe(false);
    expect(moodSchema.safeParse("spicy").success).toBe(true);
    expect(moodSchema.safeParse("hangry").success).toBe(false);
    expect([...MEAL_OCCASIONS]).toHaveLength(6);
    expect([...RECOMMENDATION_MOODS]).toHaveLength(7);
  });

  test("cuisine resolves against the catalog, not a hardcoded list", () => {
    const slugs = ["vietnamese", "japanese"];

    expect(validateRegion("cuisine", "", "", copy, slugs)).toBe(copy.recCuisineError);
    expect(validateRegion("cuisine", "french", "", copy, slugs)).toBe(copy.recCuisineError);
    expect(validateRegion("cuisine", "japanese", "", copy, slugs)).toBeNull();
    // Before the catalog loads there is nothing to check membership against.
    expect(validateRegion("cuisine", "japanese", "", copy, undefined)).toBeNull();
    expect(validateRegion("cuisine", "", "", copy, undefined)).toBe(copy.recCuisineError);
    expect(validateRegion("anywhere", "", "", copy, slugs)).toBeNull();
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

  test("saved prefs restore into a draft without touching meal or mood", () => {
    expect(draftFromSavedPrefs(null)).toEqual(EMPTY_DRAFT);

    const draft = draftFromSavedPrefs({
      remember: true,
      avoid: ["cilantro"],
      allergies: ["peanuts"],
      cuisine: "vietnamese",
    });

    expect(draft.avoidRaw).toBe("cilantro");
    expect(draft.allergiesRaw).toBe("peanuts");
    expect(draft.regionMode).toBe("cuisine");
    expect(draft.cuisine).toBe("vietnamese");
    expect(draft.remember).toBe(true);
  });

  test("surprise keeps the current meal, mood, region, and exclusions", () => {
    const payload = buildSurprisePayload({
      draft: {
        ...EMPTY_DRAFT,
        avoidRaw: "cilantro",
        allergiesRaw: "peanuts",
        regionMode: "country",
        country: "vn",
      },
      meal: "dinner",
      mood: "comforting",
      locale: "en",
    });

    expect(payload.meal).toBe("dinner");
    expect(payload.mood).toBe("comforting");
    expect(payload.country).toBe("VN");
    expect(payload.avoid).toEqual(["cilantro"]);
    expect(payload.allergies).toEqual(["peanuts"]);
  });

  test("surprise carries saved exclusions through the restored draft", () => {
    const saved = readSavedPrefs(() =>
      serializePrefs({ remember: true, avoid: ["mushrooms"], allergies: ["shrimp"] }),
    );

    const payload = buildSurprisePayload({
      draft: draftFromSavedPrefs(saved),
      meal: "anything",
      mood: "any",
      locale: "en",
    });

    expect(payload.avoid).toEqual(["mushrooms"]);
    expect(payload.allergies).toEqual(["shrimp"]);
  });

  test("surprise with no preferences still builds a valid payload", () => {
    const payload = buildSurprisePayload({
      draft: EMPTY_DRAFT,
      meal: "anything",
      mood: "any",
      locale: "en",
    });

    expect(payload.avoid).toEqual([]);
    expect(payload.allergies).toEqual([]);
    expect(payload.cuisine).toBeUndefined();
    expect(payload.country).toBeUndefined();
  });

  test("surprise never mutates the draft it reads", () => {
    const draft = {
      ...EMPTY_DRAFT,
      avoidRaw: "cilantro",
      regionMode: "cuisine" as const,
      cuisine: "vietnamese",
    };

    const before = { ...draft };

    buildSurprisePayload({ draft, meal: "lunch", mood: "light", locale: "en" });

    expect(draft).toEqual(before);
  });

  test("clear action removes storage through the injected remover", () => {
    let removed = 0;

    removeSavedPrefs(() => {
      removed += 1;
    });

    expect(removed).toBe(1);
  });
});
