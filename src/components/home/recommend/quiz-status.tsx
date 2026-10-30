import { ShieldAlertIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";

import type { Messages } from "@/shared/i18n";

/**
 * Status hierarchy for recommendation outcomes.
 *
 * - Errors (transport failure) are retryable alerts with a recovery action.
 * - Allergy limits are prominent: the backend refuses to rank when safety is
 *   unverifiable, so the refusal reads as a safety notice, never a warning.
 * - Deterministic-rank fallbacks are a subtle status line, never a panel.
 * - Unknown-dislike warnings stay visible but secondary to results.
 */
export function QuizError({
  copy,
  onRetry,
}: {
  readonly copy: Messages;
  readonly onRetry: () => void;
}) {
  return (
    <div>
      <p
        role="alert"
        className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
      >
        {copy.recError}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
      >
        {copy.recRetry}
      </button>
    </div>
  );
}

export function AllergyNotice({ copy }: { readonly copy: Messages }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-ink">
      <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
      {copy.recAllergyNotice}
    </p>
  );
}

export function ResultWarnings({
  copy,
  warnings,
}: {
  readonly copy: Messages;
  readonly warnings: ReadonlyArray<string>;
}) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border-2 border-mango bg-cream px-4 py-3">
      <p className="text-sm font-extrabold text-ink">
        <TriangleAlertIcon aria-hidden="true" className="size-4" /> {copy.recWarningsLabel}
      </p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-sm text-ink">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ranking modes that carry a visible brand. Mirrors the wire outcome subset
 * that renders dishes; the value always comes straight from `outcome.mode`
 * (quiz-flow.tsx renderOutcome) — never inferred from config, warnings, or
 * any other client-side signal.
 */
export type RecommendationModeLabel = "ai" | "deterministic";

/**
 * Server-English warning markers. The recommendation service hardcodes these
 * English sentences regardless of UI locale, so the deterministic label can
 * detect an AI-failure fallback honestly. Markers select the *explainer
 * variant* only; the `mode` prop stays the single branding source of truth.
 */
const AI_FALLBACK_MARKER = "AI ranking was";

/**
 * Interim localized sentences for mode labels (see the TODO on RankingNote).
 * One writer only: both RankingNote and AiExplanationCard read these, so the
 * inline note and the sidebar card can never drift apart.
 */
const aiExplainerFor = (copy: Messages): string => copy.recAiExplainer;

const catalogNoteFor = (copy: Messages): string => copy.recCatalogNote;

const fallbackNoteFor = (copy: Messages): string => copy.recFallbackNote;

type RankingNoteModeProps = {
  readonly mode: RecommendationModeLabel;
  readonly warnings: ReadonlyArray<string>;
  readonly copy: Messages;
};

/**
 * Mode label for the results area. AI shows a subtle sparkles
 * icon, the localized AI title, and a one-line explainer that credits Muse
 * with ranking only — catalog names and descriptions stay as curated and are
 * never presented as AI-written. Deterministic shows no icon and states the
 * picks come from the food catalog; a degraded AI attempt (fallback warning
 * present) says so instead of silently passing as catalog order.
 */
export function RankingNote(props: RankingNoteModeProps) {
  if (props.mode === "ai") {
    return (
      <div className="mb-3 flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <SparklesIcon aria-hidden="true" className="size-4 flex-none text-food-orange-strong" />
          {props.copy.recAiRankedTitle}
        </p>
        <p className="text-sm font-semibold text-muted">{aiExplainerFor(props.copy)}</p>
      </div>
    );
  }

  const degraded = props.warnings.some((warning) => warning.includes(AI_FALLBACK_MARKER));

  if (degraded) {
    return <p className="mb-3 text-sm font-semibold text-muted">{fallbackNoteFor(props.copy)}</p>;
  }

  return <p className="mb-3 text-sm font-semibold text-muted">{catalogNoteFor(props.copy)}</p>;
}

/**
 * Sidebar-ready AI explanation card. Explicit props only: `mode` (straight
 * from `outcome.mode`) is the single branding source of truth — only
 * `mode === "ai"` renders Muse branding, and only with the ranking-only
 * explainer (catalog names/descriptions are never presented as AI-written,
 * and no scores are shown or invented). Deterministic renders neutral
 * catalog wording with no icon; a degraded AI attempt (fallback warning
 * present) says so honestly instead of passing as catalog order. Empty and
 * uncertain render explanatory states — the panel owns those, so the card
 * never renders dish content for them.
 *
 * Drop-in for the lead integrator: where quiz-flow renders
 * `<RankingNote note={modeNoteFor(outcome.mode, copy)} />`, pass
 * `mode={outcome.mode} warnings={outcome.warnings} copy` here plus
 * `reasons={outcome.reasons}` for the empty/uncertain states.
 */
export type AiCardMode = "ai" | "deterministic" | "uncertain" | "empty";

const NO_REASONS: ReadonlyArray<string> = [];

export function AiExplanationCard({
  mode,
  warnings,
  copy,
  reasons = NO_REASONS,
}: {
  readonly mode: AiCardMode;
  readonly warnings: ReadonlyArray<string>;
  readonly copy: Messages;
  readonly reasons?: ReadonlyArray<string>;
}) {
  if (mode === "ai") {
    return (
      <aside
        aria-label={copy.recAiRankedTitle}
        className="rounded-2xl border-2 border-mango bg-cream px-4 py-3"
      >
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-ink">
          <SparklesIcon aria-hidden="true" className="size-4 flex-none text-food-orange-strong" />
          {copy.recAiRankedTitle}
        </p>
        <p className="mt-1 text-sm font-semibold text-ink">{aiExplainerFor(copy)}</p>
      </aside>
    );
  }

  if (mode === "deterministic") {
    const degraded = warnings.some((warning) => warning.includes(AI_FALLBACK_MARKER));

    return (
      <aside className="rounded-2xl border-2 border-border-soft bg-white px-4 py-3">
        <p className="text-sm font-semibold text-muted">
          {degraded ? fallbackNoteFor(copy) : catalogNoteFor(copy)}
        </p>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border-2 border-border-soft bg-white px-4 py-3">
      <p className="text-sm font-extrabold text-ink">{copy.recReasonsHeading}</p>
      {reasons.length > 0 ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-sm text-ink">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {mode === "empty" ? (
        <p className="mt-2 text-sm font-semibold text-muted">{copy.recEmptySuggest}</p>
      ) : null}
    </aside>
  );
}
