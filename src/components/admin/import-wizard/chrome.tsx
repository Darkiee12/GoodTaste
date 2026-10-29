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
    <ol
      aria-label={copy.adminImportStagesLabel}
      className="mx-auto flex w-full max-w-3xl flex-wrap gap-2"
    >
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
      className="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-border-soft bg-white p-6"
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
    <div className="mt-6 flex min-h-11 flex-wrap items-center gap-3 border-t border-border-soft pt-4">
      {children}
    </div>
  );
}
