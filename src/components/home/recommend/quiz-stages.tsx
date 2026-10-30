import { useRef } from "react";

import {
  formatTemplate,
  type QuizDraft,
  type RecRegionMode,
} from "@/components/home/recommend/quiz-model";
import {
  type MealOccasion,
  type RecommendationMood,
} from "@/modules/food-discovery/recommendation.constants";
import type { Messages } from "@/shared/i18n";

export interface CountryOption {
  readonly code: string;
  readonly label: string;
}

export interface DetectedRegion {
  /** Trusted ISO country code, or null when no detection is available. */
  readonly country: string | null;
  readonly locating: boolean;
}

const optionClass = (checked: boolean): string =>
  `flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition ${
    checked
      ? "border-ink bg-ink text-white"
      : "border-border-soft bg-white text-ink hover:border-food-orange"
  }`;

export interface PointerAdvance {
  readonly markPointer: () => void;
  readonly consumePointer: () => boolean;
}

/**
 * Pointer-modality gate for auto-advance. Mouse and touch clicks are
 * preceded by pointerdown; keyboard and most assistive-tech activation are
 * not. Auto-advance only consumes a pointer-marked click, so arrow-key and
 * Space/Enter exploration never yanks the visitor forward — the Continue
 * button remains the explicit path.
 */
export function usePointerAdvance(): PointerAdvance {
  const pointerRef = useRef(false);

  return {
    markPointer: () => {
      pointerRef.current = true;
    },
    consumePointer: () => {
      const wasPointer = pointerRef.current;
      pointerRef.current = false;

      return wasPointer;
    },
  };
}

const mealOptions = (copy: Messages): ReadonlyArray<{ value: MealOccasion; label: string }> => [
  { value: "breakfast", label: copy.recMealBreakfast },
  { value: "lunch", label: copy.recMealLunch },
  { value: "dinner", label: copy.recMealDinner },
  { value: "snack", label: copy.recMealSnack },
  { value: "dessert", label: copy.recMealDessert },
  { value: "anything", label: copy.recMealAnything },
];

const moodOptions = (
  copy: Messages,
): ReadonlyArray<{ value: RecommendationMood; label: string }> => [
  { value: "comforting", label: copy.recMoodComforting },
  { value: "light", label: copy.recMoodLight },
  { value: "hearty", label: copy.recMoodHearty },
  { value: "spicy", label: copy.recMoodSpicy },
  { value: "adventurous", label: copy.recMoodAdventurous },
  { value: "surprise", label: copy.recMoodSurprise },
  { value: "any", label: copy.recMoodAny },
];

export const mealLabelFor = (meal: MealOccasion, copy: Messages): string =>
  mealOptions(copy).find((option) => option.value === meal)?.label ?? copy.recReviewAny;

export const moodLabelFor = (mood: RecommendationMood, copy: Messages): string =>
  moodOptions(copy).find((option) => option.value === mood)?.label ?? copy.recReviewAny;

const countryNameFor = (code: string, options: ReadonlyArray<CountryOption>): string | undefined =>
  options.find((option) => option.code === code)?.label;

type WhereChoice = "detected" | "another" | "anywhere";

const choiceFor = (draft: QuizDraft, detected: string | null): WhereChoice => {
  if (draft.regionMode === "anywhere") {
    return "anywhere";
  }

  if (detected !== null && draft.country.toUpperCase() === detected) {
    return "detected";
  }

  return "another";
};

/**
 * Step 1 — "Where are we eating?" A trusted network-region offer in
 * human-readable form (never raw coordinates), an explicit lane to another
 * destination with a country selector, or anywhere. Completing the answer
 * auto-advances; opening the selector never does.
 */
export function WhereStep({
  copy,
  countriesError,
  countryOptions,
  detected,
  draft,
  onAdvance,
  onDraft,
  onRetryCountries,
}: {
  readonly copy: Messages;
  readonly countriesError: boolean;
  readonly countryOptions: ReadonlyArray<CountryOption>;
  readonly detected: DetectedRegion;
  readonly draft: QuizDraft;
  readonly onAdvance: () => void;
  readonly onDraft: (next: QuizDraft) => void;
  readonly onRetryCountries: () => void;
}) {
  const { consumePointer, markPointer } = usePointerAdvance();

  const choice = choiceFor(draft, detected.country);

  const detectedName =
    detected.country === null
      ? null
      : (countryNameFor(detected.country, countryOptions) ?? detected.country);

  const pick = (mode: RecRegionMode, country: string): void => {
    onDraft({ ...draft, country, regionMode: mode });
  };

  const maybeAdvance = (): void => {
    if (consumePointer()) {
      onAdvance();
    }
  };

  return (
    <fieldset className="min-w-0">
      <legend className="font-display px-2 text-2xl tracking-wide">{copy.recWhereLegend}</legend>
      <p className="mb-4 text-sm text-muted">{copy.recWhereHint}</p>
      {detected.locating ? (
        <p className="mb-4 text-sm font-semibold text-muted">{copy.recWhereLocating}</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {detected.country !== null && detectedName !== null ? (
          <label className={optionClass(choice === "detected")} onPointerDown={markPointer}>
            <input
              type="radio"
              name="rec-where"
              value="detected"
              checked={choice === "detected"}
              onChange={() => {
                pick("country", detected.country ?? "");
              }}
              onClick={maybeAdvance}
              className="size-5 flex-none accent-food-orange-strong"
            />
            {formatTemplate(copy.recWhereExploring, detectedName)}
          </label>
        ) : null}
        <label className={optionClass(choice === "another")} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="another"
            checked={choice === "another"}
            onChange={() => {
              pick("country", "");
            }}
            className="size-5 flex-none accent-food-orange-strong"
          />
          {copy.recWhereAnother}
        </label>
        <label className={optionClass(choice === "anywhere")} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="anywhere"
            checked={choice === "anywhere"}
            onChange={() => {
              pick("anywhere", "");
            }}
            onClick={maybeAdvance}
            className="size-5 flex-none accent-food-orange-strong"
          />
          {copy.recWhereAnywhere}
        </label>
      </div>

      {choice === "another" ? (
        <div className="mt-5">
          <label htmlFor="rec-country" className="mb-2 block text-sm font-bold text-ink">
            {copy.recWhereCountryLabel}
          </label>
          {countriesError ? (
            <div>
              <p
                role="alert"
                className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
              >
                {copy.recCountryLoadError}
              </p>
              <button
                type="button"
                onClick={onRetryCountries}
                className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
              >
                {copy.recRetry}
              </button>
            </div>
          ) : (
            <select
              id="rec-country"
              value={draft.country}
              onPointerDown={markPointer}
              onChange={(event) => {
                const next = event.target.value;

                if (next === "") {
                  pick("country", next);

                  return;
                }

                pick("country", next);
                maybeAdvance();
              }}
              className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink focus:border-brand-blue"
            >
              <option value="">{copy.recWhereChoose}</option>
              {countryOptions.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
          {detected.country !== null ? (
            <p className="mt-2 text-sm text-muted">{copy.recWhereDetectedNote}</p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Step 2 — "What sounds good right now?" Single-choice meal with optional
 * inline mood refinement. Only the meal auto-advances; mood is never a
 * separate mandatory page and never advances on its own.
 */
export function CravingStep({
  copy,
  meal,
  mood,
  onAdvance,
  onMeal,
  onMood,
}: {
  readonly copy: Messages;
  readonly meal: MealOccasion;
  readonly mood: RecommendationMood;
  readonly onAdvance: () => void;
  readonly onMeal: (next: MealOccasion) => void;
  readonly onMood: (next: RecommendationMood) => void;
}) {
  const { consumePointer, markPointer } = usePointerAdvance();

  return (
    <fieldset className="min-w-0">
      <legend className="font-display px-2 text-2xl tracking-wide">{copy.recCravingLegend}</legend>
      <p className="mb-4 text-sm text-muted">{copy.recCravingHint}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {mealOptions(copy).map((option) => (
          <label
            key={option.value}
            className={optionClass(meal === option.value)}
            onPointerDown={markPointer}
          >
            <input
              type="radio"
              name="rec-meal"
              value={option.value}
              checked={meal === option.value}
              onChange={() => {
                onMeal(option.value);
              }}
              onClick={() => {
                if (consumePointer()) {
                  onAdvance();
                }
              }}
              className="size-5 flex-none accent-food-orange-strong"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="mt-6 mb-3 text-sm font-bold text-ink">{copy.recMoodRefine}</p>
      <div className="flex flex-wrap gap-2">
        {moodOptions(copy).map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mood === option.value}
            onClick={() => {
              onMood(option.value);
            }}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-bold transition ${
              mood === option.value
                ? "border-ink bg-ink text-white"
                : "border-border-soft bg-white text-ink hover:border-food-orange"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Step 3 — "Anything to avoid?" Free-text dislikes plus allergies with an
 * explicit find action. Typing never advances; validation runs only on the
 * explicit Find or Skip actions.
 */
export function AvoidStep({
  copy,
  draft,
  onDraft,
}: {
  readonly copy: Messages;
  readonly draft: QuizDraft;
  readonly onDraft: (next: QuizDraft) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-display px-2 text-2xl tracking-wide">{copy.recAvoidTitle}</legend>
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
              onDraft({ ...draft, avoidRaw: event.target.value });
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
            aria-describedby="rec-allergies-note"
            onChange={(event) => {
              onDraft({ ...draft, allergiesRaw: event.target.value });
            }}
            className="min-h-11 w-full rounded-xl border-2 border-border-soft bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus:border-brand-blue"
          />
        </div>
        <p
          id="rec-allergies-note"
          className="rounded-xl border-2 border-mango bg-cream px-4 py-3 text-sm font-semibold text-ink"
        >
          {copy.recAllergyShort}
        </p>
      </div>
    </fieldset>
  );
}
