import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { ShieldAlertIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { recommendDishesFn } from "@/modules/food-discovery/food.functions";
import { localeSearchSchema, messagesFor, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/recommend")({
  validateSearch: localeSearchSchema,
  ssr: false,
  component: Recommend,
});

export const REC_MEALS = ["breakfast", "lunch", "dinner", "snack", "dessert", "anything"] as const;

export type RecMeal = (typeof REC_MEALS)[number];

export const REC_MOODS = [
  "comforting",
  "light",
  "hearty",
  "spicy",
  "adventurous",
  "surprise",
  "any",
] as const;

export type RecMood = (typeof REC_MOODS)[number];

export const REC_CUISINES = [
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
] as const;

export type RecCuisine = (typeof REC_CUISINES)[number];

export type RecRegionMode = "anywhere" | "cuisine" | "country";

export const MAX_REC_TERM_LENGTH = 100;

export const recMealSchema = z.enum(REC_MEALS);

export const recMoodSchema = z.enum(REC_MOODS);

export const recCuisineSchema = z.enum(REC_CUISINES);

export const recCountrySchema = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, "country must be an ISO 3166 code");

export interface QuizDraft {
  readonly avoidRaw: string;
  readonly allergiesRaw: string;
  readonly regionMode: RecRegionMode;
  readonly cuisine: string;
  readonly country: string;
  readonly remember: boolean;
}

export interface RecommendAnswers {
  readonly meal: RecMeal;
  readonly avoid: ReadonlyArray<string>;
  readonly allergies: ReadonlyArray<string>;
  readonly cuisine: RecCuisine | undefined;
  readonly country: string | undefined;
  readonly mood: RecMood;
  readonly locale: string;
}

export interface RecommendPayload {
  readonly meal: RecMeal;
  readonly avoid: Array<string>;
  readonly allergies: Array<string>;
  readonly cuisine: RecCuisine | undefined;
  readonly country: string | undefined;
  readonly mood: RecMood;
  readonly locale: string;
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

/** Client mirror of the server recommendation enums; undefined means "unfiltered". */
export const buildRecommendPayload = (answers: RecommendAnswers): RecommendPayload => ({
  meal: answers.meal,
  avoid: [...answers.avoid],
  allergies: [...answers.allergies],
  cuisine: answers.cuisine,
  country: answers.country,
  mood: answers.mood,
  locale: answers.locale,
});

/** Validate the region step, returning a localized error or null when it passes. */
export const validateRegion = (
  mode: RecRegionMode,
  cuisine: string,
  country: string,
  copy: Messages,
): string | null => {
  if (mode === "cuisine") {
    if (!recCuisineSchema.safeParse(cuisine).success) {
      return copy.recCuisineError;
    }

    return null;
  }

  if (mode === "country") {
    if (!recCountrySchema.safeParse(country.trim().toUpperCase()).success) {
      return copy.recCountryError;
    }

    return null;
  }

  return null;
};

const resolveCuisine = (mode: RecRegionMode, cuisine: string): RecCuisine | undefined => {
  if (mode !== "cuisine") {
    return undefined;
  }

  const parsed = recCuisineSchema.safeParse(cuisine);

  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
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

const savedPrefsSchema = z.object({
  remember: z.literal(true),
  avoid: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  cuisine: recCuisineSchema.optional(),
  country: recCountrySchema.optional(),
});

export type SavedRecommendPrefs = z.infer<typeof savedPrefsSchema>;

const PREFS_KEY = "feastjourney.recommend.prefs.v1";

const EMPTY_DRAFT: QuizDraft = {
  avoidRaw: "",
  allergiesRaw: "",
  regionMode: "anywhere",
  cuisine: "",
  country: "",
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

/**
 * Lazy useState initializer: meal/mood are per-visit (always defaults);
 * only exclusions, cuisine, and country restore, and only with prior consent.
 */
const readInitialDraft = (): QuizDraft => {
  if (typeof window === "undefined") {
    return EMPTY_DRAFT;
  }

  const saved = readSavedPrefs(() => window.localStorage.getItem(PREFS_KEY));

  if (saved === null) {
    return EMPTY_DRAFT;
  }

  let regionMode: RecRegionMode = "anywhere";

  if (saved.cuisine !== undefined) {
    regionMode = "cuisine";
  } else if (saved.country !== undefined) {
    regionMode = "country";
  }

  return {
    avoidRaw: saved.avoid.join(", "),
    allergiesRaw: saved.allergies.join(", "),
    regionMode,
    cuisine: saved.cuisine ?? "",
    country: saved.country ?? "",
    remember: true,
  };
};

const persistPrefs = (
  remember: boolean,
  avoid: ReadonlyArray<string>,
  allergies: ReadonlyArray<string>,
  cuisine: RecCuisine | undefined,
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
    allergies: [...allergies],
    cuisine,
    country,
  };

  window.localStorage.setItem(PREFS_KEY, serializePrefs(prefs));
};

const mealOptions = (copy: Messages): ReadonlyArray<{ value: RecMeal; label: string }> => [
  { value: "breakfast", label: copy.recMealBreakfast },
  { value: "lunch", label: copy.recMealLunch },
  { value: "dinner", label: copy.recMealDinner },
  { value: "snack", label: copy.recMealSnack },
  { value: "dessert", label: copy.recMealDessert },
  { value: "anything", label: copy.recMealAnything },
];

const moodOptions = (copy: Messages): ReadonlyArray<{ value: RecMood; label: string }> => [
  { value: "comforting", label: copy.recMoodComforting },
  { value: "light", label: copy.recMoodLight },
  { value: "hearty", label: copy.recMoodHearty },
  { value: "spicy", label: copy.recMoodSpicy },
  { value: "adventurous", label: copy.recMoodAdventurous },
  { value: "surprise", label: copy.recMoodSurprise },
  { value: "any", label: copy.recMoodAny },
];

const modeNoteFor = (mode: string, copy: Messages): string | null => {
  if (mode === "ai") {
    return copy.recAiNote;
  }

  if (mode === "deterministic") {
    return copy.recPopularNote;
  }

  return null;
};

const displayNameFor = (
  name: string | undefined,
  englishName: string | undefined,
  slug: string,
): string => {
  if (name !== undefined) {
    return name;
  }

  if (englishName !== undefined) {
    return englishName;
  }

  return slug;
};

const QUIZ_STEPS = 5;

type RecommendResult = Awaited<ReturnType<typeof recommendDishesFn>>;

function Recommend() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [showResults, setShowResults] = useState<boolean>(false);
  const [draft, setDraft] = useState<QuizDraft>(readInitialDraft);
  const [meal, setMeal] = useState<RecMeal>("anything");
  const [mood, setMood] = useState<RecMood>("any");
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<RecommendPayload | null>(null);

  const recommend = useMutation({
    mutationFn: (payload: RecommendPayload) => recommendDishesFn({ data: payload }),
  });

  const startSearch = (payload: RecommendPayload, remember: boolean): void => {
    persistPrefs(remember, payload.avoid, payload.allergies, payload.cuisine, payload.country);
    setSubmitted(payload);
    setStepError(null);
    setShowResults(true);
    recommend.mutate(payload);
  };

  const currentPayload = (): RecommendPayload =>
    buildRecommendPayload({
      meal,
      avoid: parseCommaList(draft.avoidRaw),
      allergies: parseCommaList(draft.allergiesRaw),
      cuisine: resolveCuisine(draft.regionMode, draft.cuisine),
      country: resolveCountry(draft.regionMode, draft.country),
      mood,
      locale: lang,
    });

  const goNext = (): void => {
    if (stepIndex === 1) {
      const lengthError = termLengthError(draft.avoidRaw, draft.allergiesRaw, copy);

      if (lengthError !== null) {
        setStepError(lengthError);

        return;
      }
    }

    if (stepIndex === 2) {
      const regionError = validateRegion(draft.regionMode, draft.cuisine, draft.country, copy);

      if (regionError !== null) {
        setStepError(regionError);

        return;
      }
    }

    setStepError(null);
    setStepIndex(stepIndex + 1);
  };

  const goBack = (): void => {
    setStepError(null);
    setStepIndex(stepIndex - 1);
  };

  const findDishes = (): void => {
    const lengthError = termLengthError(draft.avoidRaw, draft.allergiesRaw, copy);

    if (lengthError !== null) {
      setStepError(lengthError);
      setShowResults(false);
      setStepIndex(1);

      return;
    }

    const regionError = validateRegion(draft.regionMode, draft.cuisine, draft.country, copy);

    if (regionError !== null) {
      setStepError(regionError);
      setShowResults(false);
      setStepIndex(2);

      return;
    }

    startSearch(currentPayload(), draft.remember);
  };

  const surprise = (): void => {
    startSearch(
      buildRecommendPayload({
        meal: "anything",
        avoid: [],
        allergies: [],
        cuisine: undefined,
        country: undefined,
        mood: "any",
        locale: lang,
      }),
      false,
    );
  };

  const retry = (): void => {
    if (submitted === null) {
      return;
    }

    recommend.mutate(submitted);
  };

  const backToQuiz = (): void => {
    recommend.reset();
    setShowResults(false);
  };

  const startOver = (): void => {
    recommend.reset();
    setDraft(EMPTY_DRAFT);
    setMeal("anything");
    setMood("any");
    setStepError(null);
    setSubmitted(null);
    setStepIndex(0);
    setShowResults(false);
  };

  const outcome: RecommendResult | null = recommend.data ?? null;
  const hasAllergies = submitted !== null && submitted.allergies.length > 0;
  const stepLabel = `${copy.recStep} ${stepIndex + 1} ${copy.recOf} ${QUIZ_STEPS}`;

  return (
    <div
      className="mx-auto w-full max-w-2xl px-5 pt-10"
      style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}
    >
      <p className="mb-4 text-sm font-semibold">
        <Link
          to="/"
          search={{ lang }}
          className="text-brand-blue-hover underline underline-offset-4"
        >
          FeastJourney
        </Link>
      </p>

      <h1 className="font-display text-[clamp(2.25rem,7vw,3.5rem)] leading-none tracking-wide text-balance">
        {copy.recTitle}
      </h1>
      <p className="mt-3 max-w-[60ch] text-lg text-muted">{copy.recIntro}</p>

      <div className="mt-6">
        <button
          type="button"
          onClick={surprise}
          disabled={recommend.isPending}
          className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-food-orange-strong px-6 text-base font-bold text-white shadow-[0_10px_28px_rgba(194,65,12,0.35)] transition hover:-translate-y-px hover:bg-food-orange-dark disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <SparklesIcon aria-hidden="true" className="size-5" /> {copy.recSurprise}
        </button>
      </div>

      <p
        aria-live="polite"
        className={
          showResults ? "sr-only" : "mt-8 text-sm font-bold tracking-wide text-muted uppercase"
        }
      >
        {showResults ? copy.recResultsHeading : stepLabel}
      </p>

      {showResults ? (
        <section aria-labelledby="rec-results-heading" className="mt-3">
          <h2 id="rec-results-heading" className="font-display text-3xl tracking-wide">
            {copy.recResultsHeading}
          </h2>
          <div aria-live="polite" aria-busy={recommend.isPending} className="mt-4">
            {renderOutcome(copy)}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={backToQuiz}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
            >
              {copy.recAdjust}
            </button>
            <button
              type="button"
              onClick={startOver}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
            >
              {copy.recStartOver}
            </button>
          </div>
        </section>
      ) : (
        <section aria-labelledby="rec-step-heading" className="mt-3">
          <h2 id="rec-step-heading" className="sr-only">
            {stepLabel}
          </h2>

          {stepIndex === 0 ? (
            <fieldset className="rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)]">
              <legend className="font-display px-2 text-2xl tracking-wide">
                {copy.recMealLegend}
              </legend>
              <p className="mb-4 text-sm text-muted">{copy.recMealHint}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {mealOptions(copy).map((option) => (
                  <label
                    key={option.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition ${
                      meal === option.value
                        ? "border-ink bg-ink text-white"
                        : "border-border-soft bg-white text-ink hover:border-food-orange"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rec-meal"
                      value={option.value}
                      checked={meal === option.value}
                      onChange={() => {
                        setMeal(option.value);
                      }}
                      className="size-5 flex-none accent-[#c2410c]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {stepIndex === 1 ? (
            <fieldset className="rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)]">
              <legend className="font-display px-2 text-2xl tracking-wide">
                {copy.recAvoidLegend}
              </legend>
              <p className="mb-4 text-sm text-muted">{copy.recAvoidHint}</p>
              <div className="flex flex-col gap-5">
                <div>
                  <label htmlFor="rec-avoid" className="mb-2 block text-sm font-bold text-ink">
                    {copy.recAvoidLabel}
                  </label>
                  <input
                    id="rec-avoid"
                    type="text"
                    autoComplete="off"
                    value={draft.avoidRaw}
                    placeholder={copy.recAvoidPlaceholder}
                    onChange={(event) => {
                      setDraft({ ...draft, avoidRaw: event.target.value });
                    }}
                    className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label htmlFor="rec-allergies" className="mb-2 block text-sm font-bold text-ink">
                    {copy.recAllergiesLabel}
                  </label>
                  <input
                    id="rec-allergies"
                    type="text"
                    autoComplete="off"
                    value={draft.allergiesRaw}
                    placeholder={copy.recAllergiesPlaceholder}
                    aria-describedby="rec-allergies-hint"
                    onChange={(event) => {
                      setDraft({ ...draft, allergiesRaw: event.target.value });
                    }}
                    className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus:border-brand-blue"
                  />
                  <p id="rec-allergies-hint" className="mt-2 text-sm text-muted">
                    {copy.recAllergiesHint}
                  </p>
                </div>
                <p className="rounded-xl border-2 border-mango bg-cream px-4 py-3 text-sm font-semibold text-ink">
                  {copy.recStrictNote}
                </p>
              </div>
            </fieldset>
          ) : null}

          {stepIndex === 2 ? (
            <fieldset className="rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)]">
              <legend className="font-display px-2 text-2xl tracking-wide">
                {copy.recRegionLegend}
              </legend>
              <p className="mb-4 text-sm text-muted">{copy.recRegionHint}</p>
              <div className="flex flex-col gap-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-soft px-4 py-3 text-sm font-bold has-checked:border-ink has-checked:bg-ink has-checked:text-white">
                  <input
                    type="radio"
                    name="rec-region"
                    value="anywhere"
                    checked={draft.regionMode === "anywhere"}
                    onChange={() => {
                      setDraft({ ...draft, regionMode: "anywhere" });
                    }}
                    className="size-5 flex-none accent-[#c2410c]"
                  />
                  {copy.recRegionAnywhere}
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-soft px-4 py-3 text-sm font-bold has-checked:border-ink has-checked:bg-ink has-checked:text-white">
                  <input
                    type="radio"
                    name="rec-region"
                    value="cuisine"
                    checked={draft.regionMode === "cuisine"}
                    onChange={() => {
                      setDraft({ ...draft, regionMode: "cuisine" });
                    }}
                    className="size-5 flex-none accent-[#c2410c]"
                  />
                  {copy.recRegionCuisine}
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-border-soft px-4 py-3 text-sm font-bold has-checked:border-ink has-checked:bg-ink has-checked:text-white">
                  <input
                    type="radio"
                    name="rec-region"
                    value="country"
                    checked={draft.regionMode === "country"}
                    onChange={() => {
                      setDraft({ ...draft, regionMode: "country" });
                    }}
                    className="size-5 flex-none accent-[#c2410c]"
                  />
                  {copy.recRegionCountry}
                </label>
              </div>

              {draft.regionMode === "cuisine" ? (
                <div className="mt-5">
                  <label htmlFor="rec-cuisine" className="mb-2 block text-sm font-bold text-ink">
                    {copy.recCuisineLabel}
                  </label>
                  <select
                    id="rec-cuisine"
                    value={draft.cuisine}
                    onChange={(event) => {
                      setDraft({ ...draft, cuisine: event.target.value });
                    }}
                    className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink focus:border-brand-blue"
                  >
                    <option value="">{copy.recCuisineLabel}…</option>
                    {REC_CUISINES.map((cuisine) => (
                      <option key={cuisine} value={cuisine}>
                        {cuisine}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {draft.regionMode === "country" ? (
                <div className="mt-5">
                  <label htmlFor="rec-country" className="mb-2 block text-sm font-bold text-ink">
                    {copy.recCountryLabel}
                  </label>
                  <input
                    id="rec-country"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={draft.country}
                    placeholder={copy.recCountryPlaceholder}
                    onChange={(event) => {
                      setDraft({ ...draft, country: event.target.value });
                    }}
                    className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus:border-brand-blue"
                  />
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {stepIndex === 3 ? (
            <fieldset className="rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)]">
              <legend className="font-display px-2 text-2xl tracking-wide">
                {copy.recMoodLegend}
              </legend>
              <p className="mb-4 text-sm text-muted">{copy.recMoodHint}</p>
              <div className="grid grid-cols-2 gap-3">
                {moodOptions(copy).map((option) => (
                  <label
                    key={option.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition ${
                      mood === option.value
                        ? "border-ink bg-ink text-white"
                        : "border-border-soft bg-white text-ink hover:border-food-orange"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rec-mood"
                      value={option.value}
                      checked={mood === option.value}
                      onChange={() => {
                        setMood(option.value);
                      }}
                      className="size-5 flex-none accent-[#c2410c]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {stepIndex === 4 ? (
            <fieldset className="rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)]">
              <legend className="font-display px-2 text-2xl tracking-wide">
                {copy.recReviewLegend}
              </legend>
              <p className="mb-4 text-sm text-muted">{copy.recReviewHint}</p>
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex gap-3">
                  <dt className="w-24 flex-none font-bold text-ink">{copy.recReviewMeal}</dt>
                  <dd className="text-muted">{mealLabel(meal, copy)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-24 flex-none font-bold text-ink">{copy.recReviewAvoid}</dt>
                  <dd className="text-muted">{orAny(draft.avoidRaw, copy)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-24 flex-none font-bold text-ink">{copy.recReviewAllergies}</dt>
                  <dd className="text-muted">{orAny(draft.allergiesRaw, copy)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-24 flex-none font-bold text-ink">{copy.recReviewRegion}</dt>
                  <dd className="text-muted">{regionLabel(draft, copy)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-24 flex-none font-bold text-ink">{copy.recReviewMood}</dt>
                  <dd className="text-muted">{moodLabel(mood, copy)}</dd>
                </div>
              </dl>
              <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border-2 border-border-soft px-4 py-3 text-sm font-bold has-checked:border-food-orange-strong">
                <input
                  type="checkbox"
                  checked={draft.remember}
                  onChange={(event) => {
                    setDraft({ ...draft, remember: event.target.checked });
                  }}
                  className="mt-0.5 size-5 flex-none accent-[#c2410c]"
                />
                <span>
                  {copy.recRemember}
                  <span className="mt-1 block text-xs font-normal text-muted">
                    {copy.recRememberHint}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          {stepError !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
            >
              {stepError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
              >
                {copy.recBack}
              </button>
            ) : null}
            {stepIndex < QUIZ_STEPS - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
              >
                {copy.recContinue}
              </button>
            ) : (
              <button
                type="button"
                onClick={findDishes}
                disabled={recommend.isPending}
                className="inline-flex min-h-12 cursor-pointer items-center rounded-full bg-food-orange-strong px-6 text-base font-bold text-white shadow-[0_10px_28px_rgba(194,65,12,0.35)] transition hover:-translate-y-px hover:bg-food-orange-dark disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {copy.recFind}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );

  function renderOutcome(copyMessages: Messages) {
    if (recommend.isPending) {
      return (
        <div>
          <p className="text-base font-semibold text-ink">{copyMessages.recLoading}</p>
          <ul className="mt-4 grid gap-4" aria-hidden="true">
            {[0, 1, 2].map((skeleton) => (
              <li
                key={skeleton}
                className="h-28 animate-pulse rounded-2xl border border-border-soft bg-white motion-reduce:animate-none"
              />
            ))}
          </ul>
        </div>
      );
    }

    if (recommend.isError) {
      return (
        <div>
          <p
            role="alert"
            className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
          >
            {copyMessages.recError}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
          >
            {copyMessages.recRetry}
          </button>
        </div>
      );
    }

    if (outcome === null) {
      return null;
    }

    if (outcome.mode === "uncertain" || outcome.mode === "empty") {
      return (
        <div>
          <h3 className="text-lg font-extrabold text-ink">{copyMessages.recReasonsHeading}</h3>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-6 text-[0.95rem] text-ink">
            {outcome.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {hasAllergies ? (
            <p className="mt-4 rounded-2xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-ink">
              <ShieldAlertIcon aria-hidden="true" className="size-4" />{" "}
              {copyMessages.recAllergyNotice}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div>
        <ModeNote note={modeNoteFor(outcome.mode, copyMessages)} />
        {outcome.warnings.length > 0 ? (
          <div className="rounded-2xl border-2 border-mango bg-cream px-4 py-3">
            <p className="text-sm font-extrabold text-ink">
              <TriangleAlertIcon aria-hidden="true" className="size-4" />{" "}
              {copyMessages.recWarningsLabel}
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-sm text-ink">
              {outcome.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasAllergies ? (
          <p className="mt-3 flex items-start gap-2 rounded-2xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-ink">
            <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
            {copyMessages.recAllergyNotice}
          </p>
        ) : null}
        <ul className="mt-4 grid gap-4">
          {outcome.dishes.slice(0, 10).map((dish) => (
            <li key={dish.id}>
              <article className="flex h-full flex-col gap-2 rounded-2xl border border-border-soft bg-white p-6 transition hover:-translate-y-0.5 hover:border-food-orange motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <h3 className="text-lg leading-tight font-extrabold">
                  {displayNameFor(dish.name, dish.englishName, dish.slug)}
                </h3>
                {dish.name !== undefined &&
                dish.englishName !== undefined &&
                dish.name !== dish.englishName ? (
                  <p className="text-sm font-semibold text-food-orange-strong">
                    {dish.englishName}
                  </p>
                ) : null}
                {[...dish.regionNames, ...dish.categorySlugs].length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {[...dish.regionNames, ...dish.categorySlugs].map((chip) => (
                      <li
                        key={chip}
                        className="rounded-full border border-border-soft bg-cream px-3 py-1 text-xs font-bold text-muted"
                      >
                        {chip}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}

function ModeNote(properties: { note: string | null }) {
  if (properties.note === null) {
    return null;
  }

  return <p className="mb-3 text-sm font-semibold text-muted">{properties.note}</p>;
}

const mealLabel = (meal: RecMeal, copy: Messages): string => {
  const found = mealOptions(copy).find((option) => option.value === meal);

  if (found === undefined) {
    return copy.recReviewAny;
  }

  return found.label;
};

const moodLabel = (mood: RecMood, copy: Messages): string => {
  const found = moodOptions(copy).find((option) => option.value === mood);

  if (found === undefined) {
    return copy.recReviewAny;
  }

  return found.label;
};

const regionLabel = (draft: QuizDraft, copy: Messages): string => {
  if (draft.regionMode === "cuisine") {
    if (draft.cuisine === "") {
      return copy.recReviewAny;
    }

    return draft.cuisine;
  }

  if (draft.regionMode === "country") {
    const trimmed = draft.country.trim();

    if (trimmed === "") {
      return copy.recReviewAny;
    }

    return trimmed.toUpperCase();
  }

  return copy.recReviewAny;
};

const orAny = (raw: string, copy: Messages): string => {
  if (raw.trim() === "") {
    return copy.recReviewAny;
  }

  return raw.trim();
};
