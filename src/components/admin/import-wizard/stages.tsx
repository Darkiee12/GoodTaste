import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ActionFooter, StageCard } from "@/components/admin/import-wizard/chrome";
import type { ApplyOutcome, ValidationReport } from "@/components/admin/import-wizard/types";
import type { Locale, Messages } from "@/shared/i18n";

interface ValidateStageProps {
  readonly copy: Messages;
  readonly failureReason: string | null;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly onBackToSource: () => void;
  readonly onBackToUpload: () => void;
  readonly onContinue: () => void;
  readonly onRetry: () => void;
  readonly report: ValidationReport | null;
}

export function ValidateStage({
  copy,
  failureReason,
  isError,
  isPending,
  onBackToSource,
  onBackToUpload,
  onContinue,
  onRetry,
  report,
}: ValidateStageProps): ReactNode {
  return (
    <StageCard label={copy.adminStageValidate} title={copy.adminImportStepValidate} live>
      {isPending ? <p className="mt-2">{copy.adminImportValidating}</p> : null}

      {isError ? (
        <div className="mt-2">
          <p role="alert" className="font-semibold text-red-700">
            {copy.adminImportValidateFailed}
          </p>
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-5 font-bold"
              onClick={onBackToSource}
            >
              {copy.adminImportBackToSource}
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={onRetry}
            >
              {copy.adminImportRetryValidation}
            </button>
          </ActionFooter>
        </div>
      ) : null}

      {failureReason !== null ? (
        <div className="mt-2">
          <p role="alert" className="font-semibold text-red-700">
            {copy.adminImportValidationFailedPrefix} {failureReason}
          </p>
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={onBackToUpload}
            >
              {copy.adminImportBackToUpload}
            </button>
          </ActionFooter>
        </div>
      ) : null}

      {report !== null ? (
        <div className="mt-2">
          <p>
            Job {report.jobId}: {report.totalRecords} total, {report.validRecords} valid,{" "}
            {report.invalidRecords} invalid.
          </p>
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={onContinue}
            >
              {copy.adminImportContinueIssues}
            </button>
          </ActionFooter>
        </div>
      ) : null}
    </StageCard>
  );
}

interface ApplyStageProps {
  readonly applyResult: ApplyOutcome | null;
  readonly copy: Messages;
  readonly isPending: boolean;
  readonly lang: Locale;
  readonly onContinueDone: () => void;
}

export function ApplyStage({
  applyResult,
  copy,
  isPending,
  lang,
  onContinueDone,
}: ApplyStageProps): ReactNode {
  return (
    <StageCard label={copy.adminStageApply} title={copy.adminImportStepApply} live>
      {isPending ? <p className="mt-2">{copy.adminImportApplying}</p> : null}

      {applyResult !== null ? (
        <div className="mt-2">
          <p>
            Job {applyResult.jobId}: {applyResult.applied} applied, {applyResult.skippedDuplicate}{" "}
            skipped duplicates, {applyResult.failed} failed.
          </p>
          <p className="mt-3">
            <Link
              to="/admin/imports/$jobId"
              params={{ jobId: applyResult.jobId }}
              search={{ lang }}
            >
              {copy.adminImportViewJob}
            </Link>
          </p>
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={onContinueDone}
            >
              {copy.adminImportContinueDone}
            </button>
          </ActionFooter>
        </div>
      ) : null}
    </StageCard>
  );
}

interface DoneStageProps {
  readonly applyResult: ApplyOutcome | null;
  readonly copy: Messages;
  readonly lang: Locale;
  readonly validationJobId: string | null;
}

export function DoneStage({ applyResult, copy, lang, validationJobId }: DoneStageProps): ReactNode {
  return (
    <StageCard label={copy.adminStageDone} title={copy.adminImportStepDone}>
      <p aria-live="polite" className="mt-2">
        {applyResult !== null
          ? `Import ${applyResult.jobId} applied: ${applyResult.applied} records in editorial review.`
          : copy.adminImportFinished}
      </p>

      {applyResult !== null ? (
        <p className="mt-3">
          <Link to="/admin/imports/$jobId" params={{ jobId: applyResult.jobId }} search={{ lang }}>
            {copy.adminImportViewJob}
          </Link>
        </p>
      ) : null}

      {validationJobId !== null ? (
        <p className="mt-3">
          <Link to="/admin/imports/$jobId" params={{ jobId: validationJobId }} search={{ lang }}>
            {copy.adminImportViewValidationJob}
          </Link>
        </p>
      ) : null}

      <p className="mt-3">
        <Link to="/admin/imports" search={{ lang }}>
          {copy.adminImportBackToImports}
        </Link>
      </p>
    </StageCard>
  );
}
