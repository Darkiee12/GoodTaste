import { describe, expect, test } from "bun:test";

import {
  didPreciseFixArrive,
  EMPTY_DRAFT,
  isRegionComplete,
  pickDestinationCountry,
  pickRegionChoice,
  sameRegion,
  shouldAutoAdvanceRegion,
  validateRegion,
  type QuizDraft,
} from "@/components/home/recommend/quiz-model";
import { messagesFor } from "@/shared/i18n";

const copy = messagesFor("en");

const withFix = (draft: QuizDraft): QuizDraft => ({
  ...draft,
  precise: { accuracy: 25, latitude: 21.02, longitude: 105.85 },
});

describe("pickRegionChoice", () => {
  test("home pins the trusted detection as a detected country", () => {
    const next = pickRegionChoice(EMPTY_DRAFT, "home", "VN");

    expect(next.regionMode).toBe("country");
    expect(next.country).toBe("VN");
    expect(next.countrySource).toBe("detected");
    expect(next.precise).toBeNull();
  });

  test("home without detection falls back to worldwide instead of inventing a country", () => {
    const next = pickRegionChoice(EMPTY_DRAFT, "home", null);

    expect(next.regionMode).toBe("anywhere");
    expect(next.country).toBe("");
  });

  test("precise opens the locator lane with no fix", () => {
    const next = pickRegionChoice(EMPTY_DRAFT, "precise", "VN");

    expect(next.regionMode).toBe("precise");
    expect(next.precise).toBeNull();
    expect(next.country).toBe("");
  });

  test("destination opens the selector empty", () => {
    const seeded: QuizDraft = { ...EMPTY_DRAFT, country: "VN", regionMode: "country" };
    const next = pickRegionChoice(seeded, "destination", "VN");

    expect(next.regionMode).toBe("country");
    expect(next.country).toBe("");
    expect(next.countrySource).toBeNull();
  });

  test("worldwide clears lane, country, and fix", () => {
    const seeded: QuizDraft = {
      ...EMPTY_DRAFT,
      country: "VN",
      countrySource: "chosen",
      precise: { accuracy: 10, latitude: 1, longitude: 2 },
      regionMode: "precise",
    };

    const next = pickRegionChoice(seeded, "worldwide", "VN");

    expect(next).toEqual({ ...EMPTY_DRAFT, remember: false });
  });
});

describe("pickDestinationCountry", () => {
  test("a valid pick is a chosen country", () => {
    const next = pickDestinationCountry(EMPTY_DRAFT, "JP");

    expect(next.regionMode).toBe("country");
    expect(next.country).toBe("JP");
    expect(next.countrySource).toBe("chosen");
  });

  test("clearing back to the placeholder keeps the lane open but sourceless", () => {
    const seeded = pickDestinationCountry(EMPTY_DRAFT, "JP");
    const next = pickDestinationCountry(seeded, "");

    expect(next.regionMode).toBe("country");
    expect(next.country).toBe("");
    expect(next.countrySource).toBeNull();
  });
});

describe("sameRegion", () => {
  test("identical lanes match case-insensitively", () => {
    const left: QuizDraft = { ...EMPTY_DRAFT, country: "vn", regionMode: "country" };
    const right: QuizDraft = { ...EMPTY_DRAFT, country: "VN", regionMode: "country" };

    expect(sameRegion(left, right)).toBe(true);
  });

  test("lane or country changes do not match", () => {
    const base: QuizDraft = { ...EMPTY_DRAFT, country: "VN", regionMode: "country" };

    expect(sameRegion(base, { ...base, country: "JP" })).toBe(false);
    expect(sameRegion(base, { ...base, regionMode: "anywhere" })).toBe(false);
  });
});

describe("isRegionComplete / shouldAutoAdvanceRegion", () => {
  test("anywhere is complete", () => {
    expect(shouldAutoAdvanceRegion(EMPTY_DRAFT)).toBe(true);
  });

  test("detected home is complete", () => {
    expect(shouldAutoAdvanceRegion(pickRegionChoice(EMPTY_DRAFT, "home", "VN"))).toBe(true);
  });

  test("worldwide pick is complete", () => {
    expect(shouldAutoAdvanceRegion(pickRegionChoice(EMPTY_DRAFT, "worldwide", "VN"))).toBe(true);
  });

  test("empty destination selector is incomplete", () => {
    expect(shouldAutoAdvanceRegion(pickRegionChoice(EMPTY_DRAFT, "destination", "VN"))).toBe(false);
  });

  test("cleared destination is incomplete", () => {
    const cleared = pickDestinationCountry(pickDestinationCountry(EMPTY_DRAFT, "JP"), "");

    expect(shouldAutoAdvanceRegion(cleared)).toBe(false);
  });

  test("valid destination pick is complete", () => {
    expect(shouldAutoAdvanceRegion(pickDestinationCountry(EMPTY_DRAFT, "JP"))).toBe(true);
  });

  test("lowercase destination codes complete after normalization", () => {
    expect(isRegionComplete({ ...EMPTY_DRAFT, country: " vn ", regionMode: "country" })).toBe(true);
  });

  test("bogus destination codes never complete", () => {
    expect(isRegionComplete({ ...EMPTY_DRAFT, country: "XX!", regionMode: "country" })).toBe(false);
  });

  test("precise lane without a fix is incomplete", () => {
    expect(shouldAutoAdvanceRegion(pickRegionChoice(EMPTY_DRAFT, "precise", "VN"))).toBe(false);
  });

  test("precise lane with a live fix is complete", () => {
    const lane = pickRegionChoice(EMPTY_DRAFT, "precise", "VN");

    expect(shouldAutoAdvanceRegion(withFix(lane))).toBe(true);
  });
});

describe("didPreciseFixArrive", () => {
  test("null-to-fix on the precise lane is an arrival", () => {
    const lane = pickRegionChoice(EMPTY_DRAFT, "precise", "VN");

    expect(didPreciseFixArrive(lane, withFix(lane))).toBe(true);
  });

  test("no arrival when the fix was already there", () => {
    const lane = withFix(pickRegionChoice(EMPTY_DRAFT, "precise", "VN"));

    expect(didPreciseFixArrive(lane, lane)).toBe(false);
  });

  test("no arrival when the visitor moved to another lane", () => {
    const lane = pickRegionChoice(EMPTY_DRAFT, "precise", "VN");
    const moved = withFix({ ...lane, regionMode: "anywhere" });

    expect(didPreciseFixArrive(lane, moved)).toBe(false);
  });

  test("no arrival while still locating", () => {
    const lane = pickRegionChoice(EMPTY_DRAFT, "precise", "VN");

    expect(didPreciseFixArrive(lane, lane)).toBe(false);
  });
});

describe("validateRegion consistency", () => {
  test("mirrors isRegionComplete for every lane", () => {
    const cases: ReadonlyArray<QuizDraft> = [
      EMPTY_DRAFT,
      pickRegionChoice(EMPTY_DRAFT, "home", "VN"),
      pickRegionChoice(EMPTY_DRAFT, "destination", "VN"),
      pickDestinationCountry(EMPTY_DRAFT, "JP"),
      pickRegionChoice(EMPTY_DRAFT, "precise", "VN"),
      withFix(pickRegionChoice(EMPTY_DRAFT, "precise", "VN")),
    ];

    for (const candidate of cases) {
      const error = validateRegion(
        candidate.regionMode,
        candidate.country,
        copy,
        candidate.precise,
      );

      expect(error === null).toBe(isRegionComplete(candidate));
    }
  });
});
