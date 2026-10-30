import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ActionFooter, ProgressBar, StageCard } from "@/components/admin/import-wizard/chrome";
import { applyProgress, validationProgress } from "@/components/admin/import-wizard/types";
import type {
  ApplyOutcome,
  ValidationProgress,
  ValidationReport,
} from "@/components/admin/import-wizard/types";
import type { Locale, Messages } from "@/shared/i18n";

const isSizeLimitFailure = (reason: string): boolean =>
  /split the file|at most \d+|into parts/i.test(reason);

const validateProgressLine = (lang: Locale, progress: ValidationProgress | null): string | null => {
  if (progress === null) {
    return null;
  }

  if (lang === "vi") {
    return `Đã kiểm tra ${progress.processedRecords}/${progress.totalRecords} bản ghi.`;
  }

  return `Validated ${progress.processedRecords} of ${progress.totalRecords} records.`;
};

interface ValidateStageProps {
  readonly copy: Messages;
  readonly failureReason: string | null;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly lang: Locale;
  readonly onBackToSource: () => void;
  readonly onBackToUpload: () => void;
  readonly onContinue: () => void;
  readonly onContinueValidation: () => void;
  readonly onRetry: () => void;
  readonly pendingProgress: string | null;
  readonly report: ValidationReport | null;
}

export function ValidateStage({
  copy,
  failureReason,
  isError,
  isPending,
  lang,
  onBackToSource,
  onBackToUpload,
  onContinue,
  onContinueValidation,
  onRetry,
  pendingProgress,
  report,
}: ValidateStageProps): ReactNode {
  const progress = report !== null ? validationProgress(report) : null;
  const progressLine = validateProgressLine(lang, progress);

  const continueValidationLabel = lang === "vi" ? "Tiếp tục kiểm tra" : "Continue validation";

  const batchedLimitNote =
    lang === "vi"
      ? "Tập dữ liệu vượt giới hạn một lần gửi. Bước kiểm tra theo đợt sẽ xử lý từng phần — bạn không cần tự tách tệp."
      : "This dataset exceeds the single-request limit. Batched validation processes it in parts — there is no need to split the file by hand.";

  const serverDetailLabel = lang === "vi" ? "Chi tiết máy chủ" : "Server detail";

  return (
    <StageCard label={copy.adminStageValidate} title={copy.adminImportStepValidate} live>
      {isPending ? <p className="mt-2 max-w-prose">{copy.adminImportValidating}</p> : null}
      {isPending && pendingProgress !== null ? (
        <p aria-live="polite" className="mt-1 max-w-prose text-sm font-semibold text-muted">
          {pendingProgress}
        </p>
      ) : null}

      {isError ? (
        <div className="mt-2 max-w-prose">
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
        <div className="mt-2 max-w-prose">
          {isSizeLimitFailure(failureReason) ? (
            <>
              <p aria-live="polite" className="font-semibold">
                {batchedLimitNote}
              </p>
              <details className="mt-2 rounded-xl border border-border-soft p-4">
                <summary className="min-h-11 cursor-pointer font-semibold">
                  {serverDetailLabel}
                </summary>
                <p role="alert" className="mt-2 font-semibold text-red-700">
                  {copy.adminImportValidationFailedPrefix} {failureReason}
                </p>
              </details>
            </>
          ) : (
            <p role="alert" className="font-semibold text-red-700">
              {copy.adminImportValidationFailedPrefix} {failureReason}
            </p>
          )}
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

      {report !== null && progress !== null ? (
        <div className="mt-2 min-w-0">
          <div className="max-w-prose">
            <ProgressBar
              label={copy.adminImportStepValidate}
              max={progress.totalRecords}
              value={progress.processedRecords}
            />
          </div>
          <p aria-live="polite" className="mt-2 max-w-prose">
            {progressLine} Job {report.jobId}: {report.totalRecords} total, {report.validRecords}{" "}
            valid, {report.invalidRecords} invalid.
          </p>
          {progress.hasMore ? (
            <p className="mt-3 max-w-prose">
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                onClick={onContinueValidation}
              >
                {continueValidationLabel}
              </button>
            </p>
          ) : (
            <ActionFooter>
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                onClick={onContinue}
              >
                {copy.adminImportContinueIssues}
              </button>
            </ActionFooter>
          )}
        </div>
      ) : null}
    </StageCard>
  );
}

interface ApplyStageProps {
  readonly applyError: boolean;
  readonly applyResult: ApplyOutcome | null;
  readonly copy: Messages;
  readonly isPending: boolean;
  readonly lang: Locale;
  readonly onContinueDone: () => void;
  readonly onRetry: () => void;
}

export function ApplyStage({
  applyError,
  applyResult,
  copy,
  isPending,
  lang,
  onContinueDone,
  onRetry,
}: ApplyStageProps): ReactNode {
  const progress = applyResult !== null ? applyProgress(applyResult) : null;

  const processedTotal =
    progress !== null
      ? progress.applied +
        progress.skippedDuplicate +
        progress.failed +
        (progress.pendingRecords ?? 0)
      : 0;

  const processedDone =
    progress !== null ? progress.applied + progress.skippedDuplicate + progress.failed : 0;

  const partialNote =
    lang === "vi"
      ? "Một số bản ghi chưa áp dụng được. Các bản ghi đã áp dụng đang chờ kiểm duyệt biên tập; xem chi tiết tác vụ để biết lỗi."
      : "Some records could not be applied. Applied records are in editorial review; see the job detail for the failures.";

  return (
    <StageCard label={copy.adminStageApply} title={copy.adminImportStepApply} live>
      {isPending ? <p className="mt-2 max-w-prose">{copy.adminImportApplying}</p> : null}

      {applyError && applyResult === null ? (
        <div className="mt-2 max-w-prose">
          <p role="alert" className="font-semibold text-red-700">
            {copy.adminImportApplyFailed}
          </p>
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={onRetry}
            >
              {copy.commonRetry}
            </button>
          </ActionFooter>
        </div>
      ) : null}

      {applyResult !== null && progress !== null ? (
        <div className="mt-2 min-w-0">
          {progress.pendingRecords !== null && progress.pendingRecords > 0 ? (
            <div className="max-w-prose">
              <ProgressBar
                label={copy.adminImportStepApply}
                max={processedTotal}
                value={processedDone}
              />
            </div>
          ) : null}
          <p aria-live="polite" className="mt-2 max-w-prose">
            Job {applyResult.jobId}: {progress.applied} applied, {progress.skippedDuplicate} skipped
            duplicates, {progress.failed} failed.
          </p>
          {progress.failed > 0 ? (
            <p role="alert" className="mt-2 max-w-prose font-semibold text-amber-700">
              {partialNote}
            </p>
          ) : null}
          <p className="mt-3 max-w-prose">
            <Link
              to="/admin/imports/$jobId"
              params={{ jobId: applyResult.jobId }}
              search={{ lang }}
            >
              {copy.adminImportViewJob}
            </Link>
          </p>
          <ActionFooter>
            {progress.failed > 0 || progress.hasMore ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-5 font-bold"
                onClick={onRetry}
              >
                {copy.commonRetry}
              </button>
            ) : null}
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
  const progress = applyResult !== null ? applyProgress(applyResult) : null;

  const appliedLabel =
    lang === "vi" ? "Đã áp dụng — chờ kiểm duyệt biên tập" : "Applied — in editorial review";

  const skippedLabel = lang === "vi" ? "Bỏ qua trùng lặp" : "Skipped duplicates";

  const failedLabel = lang === "vi" ? "Bị từ chối" : "Rejected";

  return (
    <StageCard label={copy.adminStageDone} title={copy.adminImportStepDone}>
      <p aria-live="polite" className="mt-2 max-w-prose">
        {applyResult !== null
          ? `Import ${applyResult.jobId} applied: ${applyResult.applied} records in editorial review.`
          : copy.adminImportFinished}
      </p>

      {applyResult !== null && progress !== null ? (
        <dl className="mt-3 max-w-prose rounded-xl border border-border-soft p-4">
          <div className="flex flex-wrap gap-x-2 py-1">
            <dt className="font-semibold">{appliedLabel}</dt>
            <dd>{progress.applied}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 py-1">
            <dt className="font-semibold">{skippedLabel}</dt>
            <dd>{progress.skippedDuplicate}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 py-1">
            <dt className="font-semibold">{failedLabel}</dt>
            <dd>{progress.failed}</dd>
          </div>
        </dl>
      ) : null}

      {applyResult !== null ? (
        <p className="mt-3 max-w-prose">
          <Link to="/admin/imports/$jobId" params={{ jobId: applyResult.jobId }} search={{ lang }}>
            {copy.adminImportViewJob}
          </Link>
        </p>
      ) : null}

      {validationJobId !== null ? (
        <p className="mt-3 max-w-prose">
          <Link to="/admin/imports/$jobId" params={{ jobId: validationJobId }} search={{ lang }}>
            {copy.adminImportViewValidationJob}
          </Link>
        </p>
      ) : null}

      <p className="mt-3 max-w-prose">
        <Link to="/admin/imports" search={{ lang }}>
          {copy.adminImportBackToImports}
        </Link>
      </p>
    </StageCard>
  );
}
