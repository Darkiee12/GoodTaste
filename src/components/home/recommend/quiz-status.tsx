import { ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";

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

/** Deterministic fallback, stated honestly in one subtle line. */
export function RankingNote({ note }: { readonly note: string | null }) {
  if (note === null) {
    return null;
  }

  return <p className="mb-3 text-sm font-semibold text-muted">{note}</p>;
}
