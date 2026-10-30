import { z } from "zod";

import type { RecommendationLocation } from "@/modules/food-discovery/food.schema";
import {
  MEAL_OCCASIONS,
  RECOMMENDATION_MOODS,
  type MealOccasion,
  type RecommendationMood,
} from "@/modules/food-discovery/recommendation.constants";
import type { Messages } from "@/shared/i18n";

/** UI mirror of the shared meal vocabulary; undefined is never a meal. */
export const mealSchema = z.enum(MEAL_OCCASIONS);

/** UI mirror of the shared mood vocabulary; undefined is never a mood. */
export const moodSchema = z.enum(RECOMMENDATION_MOODS);

export type RecRegionMode = "anywhere" | "country" | "precise";

/** Step 1 choice in display order: home region, precise, destination, worldwide. */
export type RegionChoice = "home" | "precise" | "destination" | "worldwide";

/** Where a country value came from: trusted network region or explicit choice. */
export type CountrySource = "detected" | "chosen";

/** Ephemeral precise fix: client memory only, never persisted or logged. */
export interface PreciseFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number | null;
}

export const MAX_REC_TERM_LENGTH = 100;

export const recCountrySchema = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, "country must be an ISO 3166 code");

/**
 * Normalize a possibly messy country value (detection headers, restored
 * drafts) to an uppercase ISO code, or null when it is not one. The quiz
 * UI only ever offers valid codes, so this keeps invalid values from
 * reaching validation and ever surfacing as form errors.
 */
export function sanitizeCountryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();

  if (normalized === "" || !recCountrySchema.safeParse(normalized).success) {
    return null;
  }

  return normalized;
}

export interface QuizDraft {
  readonly avoidRaw: string;
  readonly allergiesRaw: string;
  readonly regionMode: RecRegionMode;
  readonly country: string;
  readonly countrySource: CountrySource | null;
  readonly precise: PreciseFix | null;
  readonly remember: boolean;
}

export interface RecommendAnswers {
  readonly meal: MealOccasion;
  readonly avoid: ReadonlyArray<string>;
  readonly allergies: ReadonlyArray<string>;
  readonly country: string | undefined;
  readonly location?: RecommendationLocation | undefined;
  readonly mood: RecommendationMood;
  readonly locale: string;
}

export interface RecommendPayload {
  readonly meal: MealOccasion;
  readonly avoid: Array<string>;
  readonly allergies: Array<string>;
  /** Legacy country mirror for display; stripped at transport when location is present. */
  readonly country?: string | undefined;
  readonly location?: RecommendationLocation | undefined;
  readonly mood: RecommendationMood;
  readonly locale: string;
  readonly surpriseSeed: number;
}

export interface SurpriseInputs {
  readonly draft: QuizDraft;
  readonly meal: MealOccasion;
  readonly mood: RecommendationMood;
  readonly locale: string;
  readonly surpriseSeed: number;
}

/** Split a comma-separated field into trimmed, deduplicated, non-empty terms. */
export const parseCommaList = (raw: string): Array<string> => {
  const seen = new Set<string>();
  const terms: Array<string> = [];

  for (const part of raw.split(",")) {
    const term = part.trim();

    if (term.length === 0 || seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms;
};

/** True when any exclusion term exceeds the server's 100-character item limit. */
export const tooLongTerms = (terms: ReadonlyArray<string>): boolean =>
  terms.some((term) => term.length > MAX_REC_TERM_LENGTH);

/** Localized error when any exclusion term exceeds the server item limit. */
export const termLengthError = (
  avoidRaw: string,
  allergiesRaw: string,
  copy: Messages,
): string | null => {
  if (tooLongTerms(parseCommaList(avoidRaw)) || tooLongTerms(parseCommaList(allergiesRaw))) {
    return copy.recTermTooLong;
  }

  return null;
};

/** Fill a `{name}` template without casts or string surgery at call sites. */
export const formatTemplate = (template: string, name: string): string =>
  template.replace("{name}", name);

/** Client mirror of the server recommendation enums; undefined means "unfiltered". */
export const buildRecommendPayload = (
  answers: RecommendAnswers & { readonly surpriseSeed?: number },
): RecommendPayload => ({
  meal: answers.meal,
  avoid: [...answers.avoid],
  allergies: [...answers.allergies],
  country: answers.country,
  location: answers.location,
  mood: answers.mood,
  locale: answers.locale,
  surpriseSeed: answers.surpriseSeed ?? 0,
});

/**
 * Transport payload: the request schema accepts country XOR location, so the
 * legacy country mirror is dropped whenever the discriminated location is
 * present. Pure and shape-preserving otherwise.
 */
export const toTransportPayload = (payload: RecommendPayload): RecommendPayload =>
  payload.location === undefined ? payload : { ...payload, country: undefined };

/**
 * Derive the discriminated location for a draft. Home region and chosen
 * destination both filter by country (provenance differs for labels only);
 * precise needs a live fix; anywhere is explicitly worldwide.
 */
export const draftLocation = (draft: QuizDraft): RecommendationLocation | undefined => {
  if (draft.regionMode === "precise") {
    const fix = draft.precise;

    if (fix === null) {
      return undefined;
    }

    return {
      kind: "precise",
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
    };
  }

  if (draft.regionMode === "country") {
    const normalized = draft.country.trim().toUpperCase();
    const parsed = recCountrySchema.safeParse(normalized);

    if (!parsed.success) {
      return undefined;
    }

    return {
      kind: draft.countrySource === "detected" ? "approx" : "destination",
      country: parsed.data,
    };
  }

  return { kind: "worldwide" };
};

/**
 * Surprise keeps the visitor's current meal, mood, region, and exclusions;
 * only the sense of direction is "surprise". It never reads or writes
 * persisted preferences as a side effect — the draft already carries any
 * saved values via its initializer. The seed rotates the ranked slice so
 * repeated clicks vary; seed 0 keeps the stable deterministic order.
 */
export const buildSurprisePayload = (inputs: SurpriseInputs): RecommendPayload =>
  buildRecommendPayload({
    meal: inputs.meal,
    avoid: parseCommaList(inputs.draft.avoidRaw),
    allergies: parseCommaList(inputs.draft.allergiesRaw),
    country: resolveCountry(inputs.draft.regionMode, inputs.draft.country),
    location: draftLocation(inputs.draft),
    mood: inputs.mood,
    locale: inputs.locale,
    surpriseSeed: inputs.surpriseSeed,
  });

/** Validate the region step, returning a localized error or null when it passes. */
export const validateRegion = (
  mode: RecRegionMode,
  country: string,
  copy: Messages,
  precise: PreciseFix | null = null,
): string | null => {
  if (mode === "country") {
    if (!recCountrySchema.safeParse(country.trim().toUpperCase()).success) {
      return copy.recCountryError;
    }

    return null;
  }

  if (mode === "precise") {
    return precise === null ? copy.recError : null;
  }

  return null;
};

/**
 * Choice precedence for the initial region: an explicit journey choice beats
 * a saved opt-in preference, which beats the trusted network region. Never
 * true for untouched defaults, so async detection can never clobber a manual
 * selection.
 */
export const isExplicitRegionChoice = (draft: QuizDraft): boolean => {
  if (draft.regionMode === "precise") {
    return true;
  }

  if (draft.regionMode === "country") {
    return draft.countrySource === "chosen";
  }

  return false;
};

/** Resolve the visible Step 1 choice from draft state and trusted detection. */
export const regionChoiceFor = (draft: QuizDraft, detected: string | null): RegionChoice => {
  if (draft.regionMode === "precise") {
    return "precise";
  }

  if (draft.regionMode === "country") {
    if (draft.countrySource === "detected") {
      return "home";
    }

    if (
      draft.countrySource === null &&
      detected !== null &&
      draft.country.toUpperCase() === detected
    ) {
      return "home";
    }

    return "destination";
  }

  return "worldwide";
};

/** Format a geolocation accuracy in meters; units need no translation. */
export const formatAccuracyM = (accuracy: number): string =>
  `±${Math.round(accuracy).toString()} m`;

/**
 * Result-scope label for the summary chips, composed from existing copy plus
 * catalog country names: approximate home regions explore by name, precise
 * fixes show the nearby label with accuracy, destinations show the plain
 * country name, worldwide stays unlabeled. Never claims city precision.
 */
export const scopeLabelFor = (
  input: {
    readonly location?: RecommendationLocation | undefined;
    readonly country?: string | undefined;
  },
  copy: Messages,
  countryOptions: ReadonlyArray<{ readonly code: string; readonly label: string }>,
): string => {
  const nameOf = (code: string): string =>
    countryOptions.find((option) => option.code === code)?.label ?? code;

  const location = input.location;

  if (location !== undefined) {
    switch (location.kind) {
      case "approx":
        return formatTemplate(copy.recWhereExploring, nameOf(location.country));
      case "precise":
        return location.accuracy === null || location.accuracy === undefined
          ? copy.recWhereNearYou
          : `${copy.recWhereNearYou} · ${formatAccuracyM(location.accuracy)}`;
      case "destination":
        return nameOf(location.country);
      case "worldwide":
        return copy.recWhereAnywhere;
    }
  }

  if (input.country !== undefined) {
    return nameOf(input.country);
  }

  return copy.recWhereAnywhere;
};

const resolveCountry = (mode: RecRegionMode, country: string): string | undefined => {
  if (mode !== "country") {
    return undefined;
  }

  const normalized = country.trim().toUpperCase();
  const parsed = recCountrySchema.safeParse(normalized);

  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
};

/**
 * Saved preferences deliberately exclude allergies: dislikes and the
 * destination persist only with explicit opt-in, while allergy text stays in
 * memory for the current visit and is never written to storage.
 */
const savedPrefsSchema = z.object({
  remember: z.literal(true),
  avoid: z.array(z.string()).default([]),
  country: recCountrySchema.optional(),
});

export type SavedRecommendPrefs = z.infer<typeof savedPrefsSchema>;

const PREFS_KEY = "feastjourney.recommend.prefs.v1";

export const EMPTY_DRAFT: QuizDraft = {
  avoidRaw: "",
  allergiesRaw: "",
  regionMode: "anywhere",
  country: "",
  countrySource: null,
  precise: null,
  remember: false,
};

/** Parse one raw storage value; any corruption or schema drift restores nothing. */
export const readSavedPrefs = (read: () => string | null): SavedRecommendPrefs | null => {
  const raw = read();

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = savedPrefsSchema.safeParse(parsed);

    if (!result.success) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
};

export const serializePrefs = (prefs: SavedRecommendPrefs): string => JSON.stringify(prefs);

/** Invoke the storage remover; the caller resets the form separately. */
export const removeSavedPrefs = (remove: () => void): void => {
  remove();
};

/**
 * Tab-scoped journey snapshot: preserves the in-progress quiz (meal, mood,
 * draft, step, submitted payload, results flag, surprise seed) across dish
 * detail visits within the same tab. In-memory only, never written to disk:
 * dietary text must not land in storage without the opt-in preference, and
 * closing or reloading the tab forgets the journey. A full reload falls back
 * to the opt-in local preferences (restrictions/region) with meal and mood
 * at their defaults.
 */

const journeySnapshotSchema = z.object({
  meal: z.enum(MEAL_OCCASIONS).default("anything"),
  mood: z.enum(RECOMMENDATION_MOODS).default("any"),
  draft: z.object({
    avoidRaw: z.string().max(500).default(""),
    allergiesRaw: z.string().max(500).default(""),
    regionMode: z.enum(["anywhere", "country", "precise"]).default("anywhere"),
    country: z.string().max(12).default(""),
    countrySource: z.enum(["detected", "chosen"]).nullable().default(null),
    remember: z.boolean().default(false),
  }),
  stepIndex: z.number().int().min(0).max(2).default(0),
  submitted: z
    .object({
      meal: z.enum(MEAL_OCCASIONS),
      avoid: z.array(z.string().max(100)).max(20),
      allergies: z.array(z.string().max(100)).max(20),
      country: recCountrySchema.optional(),
      mood: z.enum(RECOMMENDATION_MOODS),
      locale: z.string().max(12),
      surpriseSeed: z.number().int().min(0).default(0),
    })
    .nullable()
    .default(null),
  showResults: z.boolean().default(false),
  surpriseSeed: z.number().int().min(0).default(0),
});

export type JourneySnapshot = z.infer<typeof journeySnapshotSchema>;

// Module-scoped, client-only: the SPA keeps this module alive across
// client-side navigation, so dish detail visits unmounting this section
// restore from here on back-navigation. Server rendering never touches it
// (window guard), so concurrent requests cannot share state.
let journeyCache: JourneySnapshot | null = null;

export const readJourneySnapshot = (): JourneySnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return journeyCache;
};

export const writeJourneySnapshot = (snapshot: JourneySnapshot): void => {
  if (typeof window === "undefined") {
    return;
  }

  const country = sanitizeCountryCode(snapshot.draft.country);

  // Coarse context only: precise coordinates never enter the journey cache,
  // even though it is memory-only. Restoring a precise choice keeps the mode
  // so the visitor can re-locate with one explicit tap.
  journeyCache = {
    ...snapshot,
    draft: {
      avoidRaw: snapshot.draft.avoidRaw,
      allergiesRaw: snapshot.draft.allergiesRaw,
      regionMode: snapshot.draft.regionMode,
      country: country ?? "",
      countrySource: snapshot.draft.countrySource,
      remember: snapshot.draft.remember,
    },
  };
};

export const clearJourneySnapshot = (): void => {
  journeyCache = null;
};

/** Full in-memory journey state the quiz hands to the snapshot builder. */
export interface JourneyWriteModel {
  readonly meal: MealOccasion;
  readonly mood: RecommendationMood;
  readonly draft: QuizDraft;
  readonly stepIndex: number;
  readonly submitted: RecommendPayload | null;
  readonly showResults: boolean;
  readonly surpriseSeed: number;
}

/**
 * Coarse snapshot builder: precise coordinates never enter the journey
 * cache, even though it is memory-only. A precise draft keeps its mode (the
 * visitor re-locates with one explicit tap); precise results are dropped
 * instead of re-running a stale fix on return, landing back on the quiz.
 * Submitted payloads keep the legacy country mirror for restore display and
 * re-runs, never the discriminated location.
 */
export const toCoarseSnapshot = (model: JourneyWriteModel): JourneySnapshot => {
  if (model.submitted !== null && model.submitted.location?.kind === "precise") {
    return {
      meal: model.meal,
      mood: model.mood,
      draft: {
        avoidRaw: model.draft.avoidRaw,
        allergiesRaw: model.draft.allergiesRaw,
        regionMode: model.draft.regionMode,
        country: model.draft.country,
        countrySource: model.draft.countrySource,
        remember: model.draft.remember,
      },
      stepIndex: model.stepIndex,
      submitted: null,
      showResults: false,
      surpriseSeed: model.surpriseSeed,
    };
  }

  return {
    meal: model.meal,
    mood: model.mood,
    draft: {
      avoidRaw: model.draft.avoidRaw,
      allergiesRaw: model.draft.allergiesRaw,
      regionMode: model.draft.regionMode,
      country: model.draft.country,
      countrySource: model.draft.countrySource,
      remember: model.draft.remember,
    },
    stepIndex: model.stepIndex,
    // Field-by-field: the snapshot never carries the discriminated location,
    // only the legacy country mirror for coarse restore display and re-runs.
    submitted:
      model.submitted === null
        ? null
        : {
            meal: model.submitted.meal,
            avoid: model.submitted.avoid,
            allergies: model.submitted.allergies,
            country: model.submitted.country,
            mood: model.submitted.mood,
            locale: model.submitted.locale,
            surpriseSeed: model.submitted.surpriseSeed,
          },
    showResults: model.showResults,
    surpriseSeed: model.surpriseSeed,
  };
};

/**
 * Pure draft initializer from parsed prefs: only dislikes and the
 * destination restore, and only with prior consent. Allergies never restore
 * from storage. Meal and mood are per-visit and always start at defaults.
 */
export const draftFromSavedPrefs = (saved: SavedRecommendPrefs | null): QuizDraft => {
  if (saved === null) {
    return EMPTY_DRAFT;
  }

  return {
    avoidRaw: saved.avoid.join(", "),
    allergiesRaw: "",
    regionMode: saved.country === undefined ? "anywhere" : "country",
    country: saved.country ?? "",
    countrySource: saved.country === undefined ? null : "chosen",
    precise: null,
    remember: true,
  };
};

/** Lazy useState initializer: window-backed, consent-gated, corruption-proof. */
export const readInitialDraft = (): QuizDraft => {
  if (typeof window === "undefined") {
    return EMPTY_DRAFT;
  }

  return draftFromSavedPrefs(readSavedPrefs(() => window.localStorage.getItem(PREFS_KEY)));
};

export const persistPrefs = (
  remember: boolean,
  avoid: ReadonlyArray<string>,
  country: string | undefined,
): void => {
  if (typeof window === "undefined") {
    return;
  }

  if (!remember) {
    window.localStorage.removeItem(PREFS_KEY);

    return;
  }

  const prefs: SavedRecommendPrefs = {
    remember: true,
    avoid: [...avoid],
    country,
  };

  window.localStorage.setItem(PREFS_KEY, serializePrefs(prefs));
};
