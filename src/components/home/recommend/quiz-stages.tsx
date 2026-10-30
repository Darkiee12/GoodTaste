import { Globe2Icon, LocateFixedIcon, MapPinIcon, PlaneIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  DEFAULT_PROVENANCE_LABELS,
  didPreciseFixArrive,
  formatTemplate,
  pickDestinationCountry,
  pickRegionChoice,
  regionChoiceFor,
  sameRegion,
  shouldAutoAdvanceRegion,
  type AnswerOrigin,
  type PreciseFix,
  type ProvenanceLabels,
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

/**
 * Step-1 option row. The checked row renders by answer provenance: explicit
 * taps get the dark navy answer style; opt-in restored values get a softer
 * navy-on-cream with a border plus a "saved" label (never a disabled or
 * low-contrast look); app-suggested regions stay neutral with an
 * "approximate" indicator; untouched defaults render exactly like
 * unselected rows so a default never poses as an answer.
 */
const optionClass = (checked: boolean, origin: AnswerOrigin): string => {
  if (checked && origin === "explicit") {
    return "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition border-ink bg-ink text-white";
  }

  if (checked && origin === "restored") {
    return "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition border-ink bg-cream text-ink";
  }

  if (checked && origin === "suggested") {
    return "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition border-ink bg-white text-ink";
  }

  return "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold transition border-border-soft bg-white text-ink hover:border-food-orange";
};

export interface PointerAdvance {
  readonly markPointer: () => void;
  readonly clearPointer: () => void;
  readonly consumePointer: () => boolean;
}

/**
 * Pointer-modality gate for auto-advance. Mouse and touch clicks are
 * preceded by pointerdown; keyboard and most assistive-tech activation are
 * not. Auto-advance only consumes a pointer-marked change, so arrow-key
 * and Space/Enter exploration never yanks the visitor forward — the
 * Continue button remains the explicit path. Keyboards clear a stale mark
 * (e.g. a dismissed native picker) before it can misfire.
 */
export function usePointerAdvance(): PointerAdvance {
  const pointerRef = useRef(false);

  return {
    markPointer: () => {
      pointerRef.current = true;
    },
    clearPointer: () => {
      pointerRef.current = false;
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
 * region (when network-region detection knows it), an explicit
 * precise-location lane, another destination from the country catalog, or
 * worldwide. Pointer taps advance only on explicitly complete answers:
 * Anywhere and the detected country advance at once; the destination lane
 * reveals its selector and advances once a valid country is chosen;
 * Near-you geolocates only on an explicit tap and advances when the fix
 * lands (never while pending); denied/unavailable stay put with inline
 * alternatives. Untouched defaults, saved prefs, and async detection never
 * flow through the commit site, so they never advance. Keyboard and
 * assistive-tech users advance explicitly via Continue. Coordinates are
 * never displayed raw — success shows an accuracy label at most.
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
  origin,
  precise,
  provenanceLabels = DEFAULT_PROVENANCE_LABELS,
}: {
  readonly copy: Messages;
  readonly countriesError: boolean;
  readonly countryOptions: ReadonlyArray<CountryOption>;
  readonly detected: DetectedRegion;
  readonly draft: QuizDraft;
  readonly onAdvance: () => void;
  readonly onDraft: (next: QuizDraft) => void;
  readonly onRetryCountries: () => void;
  readonly origin: AnswerOrigin;
  readonly precise: PreciseControl;
  readonly provenanceLabels?: ProvenanceLabels;
}) {
  const { clearPointer, consumePointer, markPointer } = usePointerAdvance();

  const choice = regionChoiceFor(draft, detected.country);

  const detectedName =
    detected.country === null
      ? null
      : (countryNameFor(detected.country, countryOptions) ?? detected.country);

  /**
   * Single auto-advance commit site: the NEWLY picked candidate is derived
   * and validated explicitly, never the pre-update batched state. Pointer
   * taps on a changed, complete answer advance exactly once; keyboard
   * changes (no pointer mark) only update the draft.
   */
  const commit = (next: QuizDraft): void => {
    const pointer = consumePointer();
    const changed = !sameRegion(draft, next);

    onDraft(next);

    if (pointer && changed && shouldAutoAdvanceRegion(next)) {
      onAdvance();
    }
  };

  const pickChoice = (next: RegionChoice): void => {
    commit(pickRegionChoice(draft, next, detected.country));
  };

  /**
   * Near-you lane: selecting the row opens the lane but never requests or
   * advances on its own. Only an explicit pointer tap on the row fires the
   * one-shot geolocation; keyboard selection leaves the explicit locate
   * button as the path. The lane without a fix is incomplete by
   * construction, so this path can never advance.
   */
  const pickPreciseLane = (): void => {
    const next = pickRegionChoice(draft, "precise", detected.country);
    const pointer = consumePointer();
    const changed = !sameRegion(draft, next);

    onDraft(next);

    if (pointer && changed) {
      precise.request();
    }
  };

  const pickDestination = (country: string): void => {
    commit(pickDestinationCountry(draft, country));
  };

  /**
   * Near-you advances exactly once, when a live fix lands while the lane
   * is still selected. tryAdvance re-validates the written draft, so
   * locating/denied/unavailable outcomes (no fix, no draft write) stay put
   * with their inline alternatives. Leaving the lane or unmounting via
   * Continue disarms it; returning Back to a settled fix never re-fires.
   */
  const fixAdvancedRef = useRef(false);
  const previousDraftRef = useRef(draft);
  const preciseFix = precise.fix;
  useEffect(() => {
    const previous = previousDraftRef.current;
    previousDraftRef.current = draft;

    if (choice !== "precise") {
      fixAdvancedRef.current = false;

      return;
    }

    if (fixAdvancedRef.current) {
      return;
    }

    if (
      precise.status === "success" &&
      preciseFix !== null &&
      didPreciseFixArrive(previous, draft)
    ) {
      fixAdvancedRef.current = true;
      onAdvance();
    }
  });

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
          <label className={optionClass(choice === "home", origin)} onPointerDown={markPointer}>
            <input
              type="radio"
              name="rec-where"
              value="home"
              checked={choice === "home"}
              onChange={() => {
                pickChoice("home");
              }}
              className="size-5 flex-none accent-food-orange-strong"
            />
            <MapPinIcon aria-hidden="true" className="size-5 flex-none" />
            {choiceLabelFor("home", copy, detectedName)}
          </label>
        ) : null}
        <label className={optionClass(choice === "precise", origin)} onPointerDown={markPointer}>
          <input
            type="radio"
            name="rec-where"
            value="precise"
            checked={choice === "precise"}
            onChange={pickPreciseLane}
            className="size-5 flex-none accent-food-orange-strong"
          />
          <LocateFixedIcon aria-hidden="true" className="size-5 flex-none" />
          {choiceLabelFor("precise", copy, null)}
        </label>
        <label
          className={optionClass(choice === "destination", origin)}
          onPointerDown={markPointer}
        >
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
        <label className={optionClass(choice === "worldwide", origin)} onPointerDown={markPointer}>
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
      {origin === "restored" ? (
        <p className="mt-3 inline-flex items-center rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold text-ink">
          {provenanceLabels.saved}
        </p>
      ) : null}
      {origin === "suggested" ? (
        <p className="mt-3 inline-flex items-center rounded-full border-2 border-border-soft bg-white px-3 py-1 text-xs font-bold text-ink">
          {provenanceLabels.approximate}
        </p>
      ) : null}

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
              onPointerDown={markPointer}
              onKeyDown={clearPointer}
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
 * Step 2 — "What sounds good right now?" Single-choice meal quick-picks.
 * Every meal value (including "anything") is a complete answer, so pointer
 * taps advance at once; keyboard and assistive-tech users advance via
 * Continue. Mood is deliberately NOT here: meal taps used to advance before
 * visitors ever saw it, so mood now lives as an optional refinement on the
 * next step alongside the exclusions.
 */
export function CravingStep({
  copy,
  meal,
  onAdvance,
  onMeal,
  touched,
}: {
  readonly copy: Messages;
  readonly meal: MealOccasion;
  readonly onAdvance: () => void;
  readonly onMeal: (next: MealOccasion) => void;
  readonly touched: boolean;
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
            className={optionClass(meal === option.value, touched ? "explicit" : "untouched")}
            onPointerDown={markPointer}
          >
            <input
              type="radio"
              name="rec-meal"
              value={option.value}
              checked={meal === option.value}
              onChange={() => {
                const pointer = consumePointer();

                onMeal(option.value);

                if (pointer) {
                  onAdvance();
                }
              }}
              className="size-5 flex-none accent-food-orange-strong"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Step 3 — fine-tune and exclusions. Mood refinement moved here from Step 2
 * because meal quick-picks auto-advance before visitors ever saw it; mood
 * stays optional, reachable, and never advances on its own. Free-text
 * dislikes plus allergies follow with an explicit find action. Typing never
 * advances; validation runs only on the explicit Find or Skip actions. A
 * restored dislikes value renders softer navy-on-cream with a saved label;
 * confirming or editing it restores the normal style.
 */
export function AvoidStep({
  avoidOrigin,
  copy,
  draft,
  mood,
  moodTouched,
  onDraft,
  onMood,
  provenanceLabels = DEFAULT_PROVENANCE_LABELS,
}: {
  readonly avoidOrigin: AnswerOrigin;
  readonly copy: Messages;
  readonly draft: QuizDraft;
  readonly mood: RecommendationMood;
  readonly moodTouched: boolean;
  readonly onDraft: (next: QuizDraft) => void;
  readonly onMood: (next: RecommendationMood) => void;
  readonly provenanceLabels?: ProvenanceLabels;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-display px-2 text-2xl tracking-wide">{copy.recAvoidTitle}</legend>
      <p className="mb-4 text-sm text-muted">{copy.recAvoidHint}</p>
      <p className="mb-3 text-sm font-bold text-ink">{copy.recMoodRefine}</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {moodOptions(copy).map((option) => {
          const selected = mood === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onMood(option.value);
              }}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-bold transition ${
                selected && moodTouched
                  ? "border-ink bg-ink text-white"
                  : "border-border-soft bg-white text-ink hover:border-food-orange"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
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
            className={`min-h-11 w-full rounded-xl border-2 px-4 py-3 text-base text-ink placeholder:text-muted focus:border-brand-blue ${
              avoidOrigin === "restored" ? "border-ink bg-cream" : "border-border-soft bg-cream"
            }`}
          />
          {avoidOrigin === "restored" ? (
            <p className="mt-2 inline-flex items-center rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold text-ink">
              {provenanceLabels.saved}
            </p>
          ) : null}
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
