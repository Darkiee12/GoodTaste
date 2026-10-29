import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildRecommendPayload,
  buildSurprisePayload,
  clearJourneySnapshot,
  EMPTY_DRAFT,
  formatTemplate,
  persistPrefs,
  readInitialDraft,
  readJourneySnapshot,
  readSavedPrefs,
  removeSavedPrefs,
  sanitizeCountryCode,
  termLengthError,
  validateRegion,
  writeJourneySnapshot,
  type JourneySnapshot,
  type QuizDraft,
  type RecommendPayload,
} from "@/components/home/recommend/quiz-model";
import {
  AvoidStep,
  CravingStep,
  WhereStep,
  type CountryOption,
} from "@/components/home/recommend/quiz-stages";
import {
  AllergyNotice,
  QuizError,
  RankingNote,
  ResultWarnings,
} from "@/components/home/recommend/quiz-status";
import { QuizSummary, RememberPrefs } from "@/components/home/recommend/quiz-summary";
import { ResultCard, ResultCardSkeleton } from "@/components/home/recommend/result-card";
import { listCountriesFn, recommendDishesFn } from "@/modules/food-discovery/food.functions";
import { getQuizRegionFn } from "@/modules/food-discovery/quiz.functions";
import type {
  MealOccasion,
  RecommendationMood,
} from "@/modules/food-discovery/recommendation.constants";
import { useFavoriteStatus } from "@/modules/user/components/save-dish-button";
import { messagesFor, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const QUIZ_STEPS = 3;

type RecommendResult = Awaited<ReturnType<typeof recommendDishesFn>>;

const stepQuestion = (step: number, copy: Messages): string => {
  if (step === 0) {
    return copy.recWhereLegend;
  }

  if (step === 1) {
    return copy.recCravingLegend;
  }

  return copy.recAvoidTitle;
};

const modeNoteFor = (mode: string, copy: Messages): string | null => {
  if (mode === "ai") {
    return copy.recAiNote;
  }

  if (mode === "deterministic") {
    return copy.recPopularNote;
  }

  return null;
};

/**
 * Homepage recommendation quiz: a 3-step journey (where, what craving,
 * anything to avoid) replacing the old 5-step wizard. One persistent outer
 * card keeps the frame stable across steps; inner stages remount with the
 * shared 240ms enter animation and never scroll the page. Pointer clicks
 * auto-advance completed answers; keyboard and assistive-tech users advance
 * explicitly via Continue. Results collapse the old review page into a
 * compact editable summary with per-chip adjustment.
 */
export function RecommendSection() {
  const { lang } = rootRoute.useSearch();
  const { session } = rootRoute.useRouteContext();
  const copy = messagesFor(lang);

  const [journey] = useState<JourneySnapshot | null>(readJourneySnapshot);

  const [stepIndex, setStepIndex] = useState<number>(journey?.stepIndex ?? 0);
  const [showResults, setShowResults] = useState<boolean>(journey?.showResults ?? false);
  const [draft, setDraft] = useState<QuizDraft>(journey?.draft ?? readInitialDraft());
  const [meal, setMeal] = useState<MealOccasion>(journey?.meal ?? "anything");
  const [mood, setMood] = useState<RecommendationMood>(journey?.mood ?? "any");
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<RecommendPayload | null>(journey?.submitted ?? null);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [surpriseSeed, setSurpriseSeed] = useState<number>(journey?.surpriseSeed ?? 0);

  const [hasSaved, setHasSaved] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      readSavedPrefs(() => window.localStorage.getItem("feastjourney.recommend.prefs.v1")) !== null
    );
  });

  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const skipInitialFocusRef = useRef(true);

  const regionQuery = useQuery({
    queryKey: ["geo", "quiz-region"],
    queryFn: () => getQuizRegionFn(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  // Detection comes from IP-derived server headers (Cloudflare) or a dev
  // override — both untrusted strings, so only a valid uppercase ISO code
  // is ever offered as the detected region. Anything else behaves as
  // "no detection", never as a form error.
  const detectedCountry = sanitizeCountryCode(regionQuery.data?.country ?? "");

  const countries = useQuery({
    queryKey: ["catalog", "countries", lang],
    queryFn: () => listCountriesFn({ data: { locale: lang } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const countryOptions = useMemo<ReadonlyArray<CountryOption>>(
    () =>
      (countries.data ?? [])
        .flatMap((entry) =>
          entry.iso3166 === null
            ? []
            : [{ code: entry.iso3166, label: entry.displayName ?? entry.iso3166 }],
        )
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [countries.data],
  );

  const detectedName =
    detectedCountry === null
      ? null
      : (countryOptions.find((option) => option.code === detectedCountry)?.label ??
        detectedCountry);

  const recommend = useMutation({
    mutationKey: [
      "quiz",
      "recommend",
      lang,
      session.status === "signed-in" ? session.user.id : "guest",
    ],
    mutationFn: (payload: RecommendPayload) => recommendDishesFn({ data: payload }),
  });

  const restoredRef = useRef(false);
  const previousLangRef = useRef(lang);

  // Persist the in-progress journey in memory so dish detail visits (back
  // navigation remounts this route) restore form, step, and results context.
  useEffect(() => {
    const snapshot: JourneySnapshot = {
      meal,
      mood,
      draft,
      stepIndex,
      submitted,
      showResults,
      surpriseSeed,
    };

    writeJourneySnapshot(snapshot);
  }, [meal, mood, draft, stepIndex, submitted, showResults, surpriseSeed]);

  // On remount with a restored results flag, re-run the submitted search once
  // so results reflect fresh catalog data instead of stale snapshots.
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }

    restoredRef.current = true;

    if (journey?.showResults === true && journey.submitted !== null) {
      recommend.mutate(journey.submitted);
    }
    // Mount-only restore: the mutation object is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching language while results are visible re-runs the submitted
  // search in the new locale instead of showing stale-language dishes. The
  // lang guard keeps unrelated state updates from re-firing the search.
  useEffect(() => {
    if (previousLangRef.current === lang) {
      return;
    }

    previousLangRef.current = lang;
    setStepError(null);

    if (submitted !== null && showResults) {
      const relocalized: RecommendPayload = { ...submitted, locale: lang };
      setSubmitted(relocalized);
      recommend.mutate(relocalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, submitted, showResults]);

  // Predictable focus: each step and the results heading receive focus on
  // entry (without scrolling), so keyboard and screen-reader users land on
  // the question. The initial mount keeps natural focus.
  useEffect(() => {
    if (skipInitialFocusRef.current) {
      skipInitialFocusRef.current = false;

      return;
    }

    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [stepIndex, showResults]);

  const startSearch = (payload: RecommendPayload, remember: boolean): void => {
    persistPrefs(remember, payload.avoid, payload.country);
    setHasSaved(remember);
    setSubmitted(payload);
    setStepError(null);
    setShowResults(true);
    recommend.mutate(payload);
  };

  const currentPayload = (seed: number): RecommendPayload =>
    buildSurprisePayload({
      draft,
      meal,
      mood,
      locale: lang,
      surpriseSeed: seed,
    });

  /**
   * Shared step validation for Continue and pointer auto-advance: the answer
   * must be complete before leaving. Auto-advance call sites only fire on
   * already-complete answers; this is the keyboard/assistive-tech path's
   * guard and the defensive backstop.
   */
  const tryAdvance = (): void => {
    if (stepIndex === 0) {
      const regionError = validateRegion(draft.regionMode, draft.country, copy);

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

      return;
    }

    const regionError = validateRegion(draft.regionMode, draft.country, copy);

    if (regionError !== null) {
      setStepError(regionError);
      setShowResults(false);
      setStepIndex(0);

      return;
    }

    startSearch(currentPayload(0), draft.remember);
  };

  const skipExclusions = (): void => {
    const regionError = validateRegion(draft.regionMode, draft.country, copy);

    if (regionError !== null) {
      setStepError(regionError);
      setShowResults(false);
      setStepIndex(0);

      return;
    }

    startSearch(
      buildRecommendPayload({
        meal,
        avoid: [],
        allergies: [],
        country: draft.regionMode === "country" ? draft.country.trim().toUpperCase() : undefined,
        mood,
        locale: lang,
        surpriseSeed: 0,
      }),
      draft.remember,
    );
  };

  /**
   * Surprise keeps the current meal, mood, region, and exclusions and never
   * touches saved preferences: no persist, no clear. Each click bumps a
   * bounded seed so the server offsets a window into the eligible pool —
   * same filters, different dishes. Allergies still refuse before ranking.
   */
  const surprise = (): void => {
    const nextSeed = surpriseSeed + 1;
    setSurpriseSeed(nextSeed);
    const payload = currentPayload(nextSeed);

    setSubmitted(payload);
    setStepError(null);
    setShowResults(true);
    recommend.mutate(payload);
  };

  /** Wipe saved preferences and reset the whole form; storage first. */
  const clearSaved = (): void => {
    if (typeof window !== "undefined") {
      removeSavedPrefs(() => window.localStorage.removeItem("feastjourney.recommend.prefs.v1"));
    }

    clearJourneySnapshot();

    recommend.reset();
    setDraft(EMPTY_DRAFT);
    setMeal("anything");
    setMood("any");
    setStepError(null);
    setSubmitted(null);
    setStepIndex(0);
    setShowResults(false);
    setConfirmClear(false);
    setHasSaved(false);
    setSurpriseSeed(0);
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

  const editStep = (step: number): void => {
    recommend.reset();
    setShowResults(false);
    setStepError(null);
    setStepIndex(step);
  };

  const startOver = (): void => {
    clearJourneySnapshot();

    recommend.reset();
    setDraft(EMPTY_DRAFT);
    setMeal("anything");
    setMood("any");
    setStepError(null);
    setSubmitted(null);
    setStepIndex(0);
    setShowResults(false);
    setConfirmClear(false);
    setSurpriseSeed(0);
  };

  const outcome: RecommendResult | null = recommend.data ?? null;
  const hasAllergies = submitted !== null && submitted.allergies.length > 0;
  const stepLabel = `${copy.recStep} ${stepIndex + 1} ${copy.recOf} ${QUIZ_STEPS}`;
  const resultUserId = session.status === "signed-in" ? session.user.id : null;

  const resultIds = useMemo(
    () =>
      outcome !== null && (outcome.mode === "ai" || outcome.mode === "deterministic")
        ? outcome.dishes.map((dish) => dish.id)
        : [],
    [outcome],
  );

  const resultFavorites = useFavoriteStatus(resultIds, resultUserId);

  return (
    <section
      id="recommend"
      aria-labelledby="recommend-heading"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 pt-10"
      style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}
    >
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-24">
          <h1
            id="recommend-heading"
            className="font-display text-[clamp(2.25rem,7vw,3.5rem)] leading-none tracking-wide text-balance"
          >
            {copy.recTitle}
          </h1>
          <p className="mt-3 max-w-[60ch] text-lg text-muted">{copy.recIntro}</p>
          {detectedName !== null ? (
            <p className="mt-3 max-w-[60ch] text-base font-bold text-ink">
              {formatTemplate(copy.recWhereExploring, detectedName)}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={surprise}
              disabled={recommend.isPending}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
            >
              <SparklesIcon aria-hidden="true" className="size-4" /> {copy.recSurprise}
            </button>
            <button
              type="button"
              onClick={findDishes}
              disabled={recommend.isPending}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-4 text-sm font-bold text-ink transition hover:border-ink disabled:cursor-wait disabled:opacity-70"
            >
              {copy.recQuick}
            </button>
          </div>
        </div>
        <div>
          <p
            aria-live="polite"
            className={
              showResults ? "sr-only" : "text-sm font-bold tracking-wide text-muted uppercase"
            }
          >
            {showResults ? copy.recResultsHeading : stepLabel}
          </p>

          {showResults ? (
            <section
              aria-labelledby="rec-results-heading"
              className="mt-3 min-h-[28rem] motion-safe:animate-rec-step-enter sm:min-h-[24rem]"
            >
              <h2
                id="rec-results-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="font-display text-3xl tracking-wide outline-none"
              >
                {copy.recResultsHeading}
              </h2>
              <div aria-live="polite" aria-busy={recommend.isPending} className="mt-4">
                {renderOutcome(copy)}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={backToQuiz}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
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
              <div className="min-h-[30rem] rounded-3xl border-2 border-border-soft bg-white p-6 shadow-[0_12px_28px_rgba(194,65,12,0.08)] sm:min-h-[26rem]">
                <h2 id="rec-step-heading" ref={stepHeadingRef} tabIndex={-1} className="sr-only">
                  {`${stepLabel}: ${stepQuestion(stepIndex, copy)}`}
                </h2>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold tracking-wide text-muted uppercase">
                    {stepLabel}
                  </p>
                  <div aria-hidden="true" className="flex gap-1.5">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className={`h-2 w-8 rounded-full ${dot <= stepIndex ? "bg-food-orange-strong" : "bg-border-soft"}`}
                      />
                    ))}
                  </div>
                </div>

                <div key={stepIndex} className="motion-safe:animate-rec-step-enter">
                  {stepIndex === 0 ? (
                    <WhereStep
                      copy={copy}
                      countriesError={countries.isError}
                      countryOptions={countryOptions}
                      detected={{ country: detectedCountry, locating: regionQuery.isPending }}
                      draft={draft}
                      onAdvance={tryAdvance}
                      onDraft={setDraft}
                      onRetryCountries={() => {
                        void countries.refetch();
                      }}
                    />
                  ) : null}

                  {stepIndex === 1 ? (
                    <CravingStep
                      copy={copy}
                      meal={meal}
                      mood={mood}
                      onAdvance={tryAdvance}
                      onMeal={setMeal}
                      onMood={setMood}
                    />
                  ) : null}

                  {stepIndex === 2 ? (
                    <AvoidStep copy={copy} draft={draft} onDraft={setDraft} />
                  ) : null}
                </div>

                {stepError !== null ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
                  >
                    {stepError}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border-soft pt-5">
                  {stepIndex > 0 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
                    >
                      {copy.recBack}
                    </button>
                  ) : (
                    <span aria-hidden="true" className="invisible inline-flex min-h-11 px-5" />
                  )}
                  {stepIndex < QUIZ_STEPS - 1 ? (
                    <button
                      type="button"
                      onClick={tryAdvance}
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
                    >
                      {copy.recContinue}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={skipExclusions}
                        disabled={recommend.isPending}
                        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink disabled:cursor-wait disabled:opacity-70"
                      >
                        {copy.recSkip}
                      </button>
                      <button
                        type="button"
                        onClick={findDishes}
                        disabled={recommend.isPending}
                        className="inline-flex min-h-12 cursor-pointer items-center rounded-full bg-food-orange-strong px-6 text-base font-bold text-white shadow-[0_10px_28px_rgba(194,65,12,0.35)] transition hover:-translate-y-px hover:bg-food-orange-dark disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                      >
                        {copy.recFindMine}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );

  function renderOutcome(copyMessages: Messages) {
    if (recommend.isPending) {
      return (
        <div>
          <p className="text-base font-semibold text-ink">{copyMessages.recLoading}</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((skeleton) => (
              <li key={skeleton}>
                <ResultCardSkeleton />
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (recommend.isError) {
      return <QuizError copy={copyMessages} onRetry={retry} />;
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
          {outcome.mode === "empty" ? (
            <p className="mt-3 text-sm font-semibold text-muted">{copyMessages.recEmptySuggest}</p>
          ) : null}
          {hasAllergies ? (
            <div className="mt-4">
              <AllergyNotice copy={copyMessages} />
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div>
        {submitted !== null ? (
          <QuizSummary
            allergies={submitted.allergies}
            avoid={submitted.avoid}
            copy={copyMessages}
            countryOptions={countryOptions}
            detectedName={detectedName}
            meal={submitted.meal}
            mood={submitted.mood}
            onEditStep={editStep}
            submittedCountry={submitted.country}
          />
        ) : null}
        <div className="mt-4">
          <RankingNote note={modeNoteFor(outcome.mode, copyMessages)} />
        </div>
        {outcome.warnings.length > 0 ? (
          <div className="mt-3">
            <ResultWarnings copy={copyMessages} warnings={outcome.warnings} />
          </div>
        ) : null}
        {hasAllergies ? (
          <div className="mt-3">
            <AllergyNotice copy={copyMessages} />
          </div>
        ) : null}
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {outcome.dishes.slice(0, 10).map((dish) => (
            <li key={dish.id}>
              <ResultCard
                copy={copyMessages}
                dish={dish}
                favoriteStatus={resultFavorites}
                lang={lang}
                session={session}
              />
            </li>
          ))}
        </ul>
        <RememberPrefs
          checked={draft.remember}
          copy={copyMessages}
          hasSaved={hasSaved}
          onChange={(next) => {
            setDraft({ ...draft, remember: next });
          }}
          onClear={() => {
            setConfirmClear(true);
          }}
          onConfirmClear={clearSaved}
          onDismissClear={() => {
            setConfirmClear(false);
          }}
          showConfirmClear={confirmClear}
        />
      </div>
    );
  }
}
