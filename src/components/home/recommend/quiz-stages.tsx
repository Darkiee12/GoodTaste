import { Globe2Icon, LocateFixedIcon, MapPinIcon, PlaneIcon } from "lucide-react";
import { useRef } from "react";

import {
  formatTemplate,
  regionChoiceFor,
  type PreciseFix,
  type QuizDraft,
  type RegionChoice,
} from "@/components/home/recommend/quiz-model";
import {
  accuracyLabelFor,
  fallbackOptionsFor,
  type PreciseStatus,
} from "@/components/home/recommend/use-precise-location";
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

export interface PreciseControl {
  readonly status: PreciseStatus;
  readonly fix: PreciseFix | null;
  readonly request: () => void;
}

const choiceLabelFor = (
  choice: RegionChoice,
  copy: Messages,
  detectedName: string | null,
): string => {
  if (choice === "home" && detectedName !== null) {
    return formatTemplate(copy.recWhereExploring, detectedName);
  }

  if (choice === "precise") {
    return copy.recWhereNearYou;
  }

  if (choice === "destination") {
    return copy.recWhereAnother;
  }

  return copy.recWhereAnywhere;
};

/**
 * Step 1 — "Where should we explore?" Four ordered choices: the trusted home
 * region (default when network-region detection knows it), an explicit
 * precise-location lane, another destination from the country catalog, or
 * worldwide. Only the complete approximate region auto-advances on pointer;
 * precise fixes, destination picks, and worldwide wait for Continue, and
 * nothing advances while geolocation is pending. Coordinates are never
 * displayed raw — success shows an accuracy label at most.
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
  precise,
}: {
  readonly copy: Messages;
  readonly countriesError: boolean;
  readonly countryOptions: ReadonlyArray<CountryOption>;
  readonly detected: DetectedRegion;
  readonly draft: QuizDraft;
  readonly onAdvance: () => void;
  readonly onDraft: (next: QuizDraft) => void;
  readonly onRetryCountries: () => void;
  readonly precise: PreciseControl;
}) {
  const { consumePointer, markPointer } = usePointerAdvance();

  const choice = regionChoiceFor(draft, detected.country);

  const detectedName =
    detected.country === null
      ? null
      : (countryNameFor(detected.country, countryOptions) ?? detected.country);

  const pickDestination = (country: string): void => {
    onDraft({
      ...draft,
      country,
      countrySource: country === "" ? null : "chosen",
      precise: null,
      regionMode: "country",
    });
  };

  const pickChoice = (next: RegionChoice): void => {
    if (next === "home" && detected.country !== null) {
      onDraft({
        ...draft,
        country: detected.country,
        countrySource: "detected",
        precise: null,
        regionMode: "country",
      });

      return;
    }

    if (next === "precise") {
      onDraft({ ...draft, country: "", countrySource: null, precise: null, regionMode: "precise" });

      return;
    }

    if (next === "destination") {
      onDraft({ ...draft, country: "", countrySource: null, precise: null, regionMode: "country" });

      return;
    }

    onDraft({ ...draft, country: "", countrySource: null, precise: null, regionMode: "anywhere" });
  };

  const maybeAdvanceHome = (): void => {
    if (consumePointer()) {
      onAdvance();
    }
  };

  const failed = fallbackOptionsFor(precise.status, detected.country);

  const showAlternatives =
    choice === "precise" &&
    (precise.status === "denied" ||
      precise.status === "timeout" ||
      precise.status === "unavailable" ||
      precise.status === "unsupported" ||
      precise.status === "insecure");

  return (
    <fieldset className="min-w-0">
      <legend className="font-display px-2 text-2xl tracking-wide">{copy.recWhereLegend}</legend>
      <p className="mb-4 text-sm text-muted">{copy.recWhereHint}</p>
      {detected.locating ? (
        <p className="mb-4 text-sm font-semibold text-muted">{copy.recWhereLocating}</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {detected.country !== null && detectedName !== null ? (
          <label className={optionClass(choice === "home")} onPointerDown={markPointer}>
            <input
              type="radio"
              name="rec-where"
              value="home"
              checked={choice === "home"}
              onChange={() => {
                pickChoice("home");
              }}
              onClick={maybeAdvanceHome}
              className="size-5 flex-none accent-food-orange-strong"
            />
            <MapPinIcon aria-hidden="true" className="size-5 flex-none" />
            {choiceLabelFor("home", copy, detectedName)}
          </label>
        ) : null}
        <label className={optionClass(choice === "precise")} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="precise"
            checked={choice === "precise"}
            onChange={() => {
              pickChoice("precise");
            }}
            onClick={() => {
              if (consumePointer()) {
                precise.request();
              }
            }}
            className="size-5 flex-none accent-food-orange-strong"
          />
          <LocateFixedIcon aria-hidden="true" className="size-5 flex-none" />
          {choiceLabelFor("precise", copy, null)}
        </label>
        <label className={optionClass(choice === "destination")} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="destination"
            checked={choice === "destination"}
            onChange={() => {
              pickChoice("destination");
            }}
            className="size-5 flex-none accent-food-orange-strong"
          />
          <PlaneIcon aria-hidden="true" className="size-5 flex-none" />
          {choiceLabelFor("destination", copy, null)}
        </label>
        <label className={optionClass(choice === "worldwide")} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="worldwide"
            checked={choice === "worldwide"}
            onChange={() => {
              pickChoice("worldwide");
            }}
            className="size-5 flex-none accent-food-orange-strong"
          />
          <Globe2Icon aria-hidden="true" className="size-5 flex-none" />
          {choiceLabelFor("worldwide", copy, null)}
        </label>
      </div>

      {choice === "precise" ? (
        <div aria-live="polite" className="mt-5 min-h-6">
          {precise.status === "locating" ? (
            <p className="text-sm font-semibold text-muted">{copy.recWhereLocating}</p>
          ) : null}
          {precise.status === "success" && precise.fix !== null ? (
            <div className="flex flex-wrap items-center gap-3">
              <output className="block text-sm font-bold text-ink">
                {accuracyLabelFor(precise.fix) ?? copy.recWhereNearYou}
              </output>
              <button
                type="button"
                onClick={precise.request}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-4 text-xs font-bold text-ink transition hover:border-ink"
              >
                {copy.recRetry}
              </button>
            </div>
          ) : null}
          {precise.status === "idle" ? (
            <button
              type="button"
              onClick={precise.request}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-sm font-bold text-white transition hover:opacity-90"
            >
              <LocateFixedIcon aria-hidden="true" className="size-4" />
              {copy.recWhereNearYou}
            </button>
          ) : null}
          {showAlternatives ? (
            <div>
              <p role="alert" className="text-sm font-bold text-danger">
                {precise.status === "denied" ? copy.discoverLocalUnknown : copy.recError}
              </p>
              {precise.status === "denied" ? (
                <p className="mt-1 text-sm text-muted">{copy.recEmptySuggest}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {failed
                  .filter((option) => option.choice !== "precise")
                  .map((option) => (
                    <button
                      key={option.choice}
                      type="button"
                      onClick={() => {
                        pickChoice(option.choice);
                      }}
                      className="inline-flex min-h-10 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-4 text-xs font-bold text-ink transition hover:border-ink"
                    >
                      {choiceLabelFor(option.choice, copy, detectedName)}
                    </button>
                  ))}
                {failed.some((option) => option.retryPrecise) ? (
                  <button
                    type="button"
                    onClick={precise.request}
                    className="inline-flex min-h-10 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-4 text-xs font-bold text-ink transition hover:bg-ink hover:text-white"
                  >
                    {copy.recRetry}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {choice === "destination" ? (
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
              onChange={(event) => {
                pickDestination(event.target.value);
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
