import { ShieldAlertIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";

import type { Locale, Messages } from "@/shared/i18n";

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

type RankingNoteLegacyProps = {
  readonly note: string | null;
  readonly mode?: undefined;
  readonly warnings?: undefined;
  readonly copy?: undefined;
  readonly lang?: undefined;
};

type RankingNoteModeProps = {
  readonly note?: string | null | undefined;
  readonly mode: RecommendationModeLabel;
  readonly warnings: ReadonlyArray<string>;
  readonly copy: Messages;
  readonly lang: Locale;
};

/**
 * Mode label rendered under the results heading. AI shows a subtle sparkles
 * icon, the localized AI note, and a one-line explainer that credits Muse
 * with ranking only — catalog names and descriptions stay as curated and are
 * never presented as AI-written. Deterministic shows no icon and states the
 * picks come from the food catalog; a degraded AI attempt (fallback warning
 * present) says so instead of silently passing as catalog order. The legacy
 * `note`-only shape is preserved until quiz-flow adopts the mode props.
 *
 * TODO(i18n-coordinator): promote the interim lang-conditional sentences to
 * recAiExplainer / recCatalogNote / recFallbackNote in src/shared/i18n.ts.
 * Interim copy lives here so this file stays the only writer of mode labels.
 */
export function RankingNote(props: RankingNoteLegacyProps | RankingNoteModeProps) {
  if (props.mode === undefined) {
    if (props.note === null) {
      return null;
    }

    return <p className="mb-3 text-sm font-semibold text-muted">{props.note}</p>;
  }

  if (props.mode === "ai") {
    return (
      <div className="mb-3 flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <SparklesIcon aria-hidden="true" className="size-4 flex-none text-food-orange-strong" />
          {props.copy.recAiNote}
        </p>
        <p className="text-sm font-semibold text-muted">
          {props.lang === "vi"
            ? "Muse chỉ sắp xếp lại các món trong danh mục — tên và mô tả giữ nguyên bản biên tập."
            : "Muse re-ranked these catalog matches — names and descriptions stay as curated."}
        </p>
      </div>
    );
  }

  const degraded = props.warnings.some((warning) => warning.includes(AI_FALLBACK_MARKER));

  if (degraded) {
    return (
      <p className="mb-3 text-sm font-semibold text-muted">
        {props.lang === "vi"
          ? "Xếp hạng AI không khả dụng nên danh sách này theo thứ tự danh mục — không phải do AI xếp hạng."
          : "AI ranking was unavailable, so these follow catalog order — not AI-ranked."}
      </p>
    );
  }

  return (
    <p className="mb-3 text-sm font-semibold text-muted">
      {props.lang === "vi"
        ? "Được chọn từ danh mục món ăn, không qua xếp hạng AI."
        : "Selected from our food catalog without AI ranking."}
    </p>
  );
}
