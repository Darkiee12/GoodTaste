import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { STAGES } from "@/components/admin/import-wizard/types";
import type { Stage } from "@/components/admin/import-wizard/types";
import type { Messages } from "@/shared/i18n";

export const stageLabels = (copy: Messages): ReadonlyArray<{ stage: Stage; label: string }> => [
  { stage: "upload", label: copy.adminStageUpload },
  { stage: "source", label: copy.adminStageSource },
  { stage: "validate", label: copy.adminStageValidate },
  { stage: "issues", label: copy.adminStageIssues },
  { stage: "confirm", label: copy.adminStageConfirm },
  { stage: "apply", label: copy.adminStageApply },
  { stage: "done", label: copy.adminStageDone },
];

interface StepProgressProps {
  readonly copy: Messages;
  readonly stage: Stage;
}

export function StepProgress({ copy, stage }: StepProgressProps): ReactNode {
  const stageIndex = STAGES.indexOf(stage);

  return (
    <ol aria-label={copy.adminImportStagesLabel} className="flex w-full min-w-0 flex-wrap gap-2">
      {stageLabels(copy).map((entry, index) => {
        const done = index < stageIndex;
        const current = entry.stage === stage;

        return (
          <li
            key={entry.stage}
            aria-current={current ? "step" : undefined}
            className={
              current
                ? "rounded-full border border-brand-blue bg-brand-blue/10 px-3 py-1 text-sm font-bold text-brand-blue"
                : "rounded-full border border-border-soft px-3 py-1 text-sm text-muted"
            }
          >
            <span>
              {index + 1}. {entry.label}
            </span>
            {done ? copy.adminImportDoneSuffix : null}
          </li>
        );
      })}
    </ol>
  );
}

interface StageCardProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly live?: boolean;
  readonly title: string;
}

export function StageCard({ children, label, live, title }: StageCardProps): ReactNode {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-label={label}
      aria-live={live === true ? "polite" : undefined}
      className="w-full min-w-0 rounded-2xl border border-border-soft bg-white p-6 sm:p-8"
    >
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-2xl tracking-wide outline-none"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ActionFooter({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="mt-6 flex min-w-0 flex-wrap items-center gap-3 border-t border-border-soft pt-4">
      {children}
    </div>
  );
}

/**
 * Consistent two-column stage composition: the working surface fills the
 * wizard width while guidance/schema notes sit in a capped aside on
 * desktop and stack below on mobile. Single column when no aside is given.
 */
export function StageColumns({
  aside,
  main,
}: {
  readonly aside?: ReactNode;
  readonly main: ReactNode;
}): ReactNode {
  if (aside === undefined) {
    return <div className="min-w-0">{main}</div>;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="min-w-0">{main}</div>
      <div className="min-w-0">
        <div className="rounded-xl border border-border-soft bg-cream/60 p-4 lg:sticky lg:top-4">
          {aside}
        </div>
      </div>
    </div>
  );
}

/**
 * Determinate progress with a natively reduced-motion-safe rendering: the
 * `progress` element jumps between values with no author animation.
 */
export function ProgressBar({
  label,
  max,
  value,
}: {
  readonly label: string;
  readonly max: number;
  readonly value: number;
}): ReactNode {
  const safeMax = max > 0 ? max : 0;
  const safeValue = Math.min(Math.max(value, 0), safeMax);

  return (
    <progress
      aria-label={label}
      max={safeMax}
      value={safeValue}
      className="h-3 w-full min-w-0 appearance-none overflow-hidden rounded-full bg-cream [&::-webkit-progress-bar]:bg-cream [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand-blue [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-brand-blue"
    />
  );
}
