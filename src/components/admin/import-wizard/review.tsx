import type { ReactNode } from "react";

import { ActionFooter, StageCard } from "@/components/admin/import-wizard/chrome";
import { AckCheckbox } from "@/components/admin/import-wizard/fields";
import type { ValidationItem, ValidationReport } from "@/components/admin/import-wizard/types";
import type { ImportLicense } from "@/modules/food-discovery/admin.schema";
import type { Messages } from "@/shared/i18n";

interface InvalidRowsProps {
  readonly copy: Messages;
  readonly items: ReadonlyArray<ValidationItem>;
}

function InvalidRows({ copy, items }: InvalidRowsProps): ReactNode {
  if (items.length === 0) {
    return <p className="mt-3">{copy.adminImportNoInvalid}</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="py-2 text-left font-semibold">{copy.adminImportInvalidCaption}</caption>
        <thead>
          <tr className="border-b border-border-soft">
            <th scope="col" className="px-2 py-2">
              {copy.adminImportExternalRef}
            </th>
            <th scope="col" className="px-2 py-2">
              {copy.adminSlug}
            </th>
            <th scope="col" className="px-2 py-2">
              {copy.adminImportErrorsCol}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.externalRef} className="border-b border-border-soft align-top">
              <td className="px-2 py-2">{item.externalRef}</td>
              <td className="px-2 py-2">{item.slug ?? "—"}</td>
              <td className="px-2 py-2">{item.errors.join(" | ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DuplicateRowsProps {
  readonly acknowledged: ReadonlyArray<string>;
  readonly copy: Messages;
  readonly items: ReadonlyArray<ValidationItem>;
  readonly onToggle: (externalRef: string) => void;
}

function DuplicateRows({ acknowledged, copy, items, onToggle }: DuplicateRowsProps): ReactNode {
  if (items.length === 0) {
    return <p className="mt-3">{copy.adminImportNoDuplicates}</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="py-2 text-left font-semibold">
          {copy.adminImportDuplicatesCaption}
        </caption>
        <thead>
          <tr className="border-b border-border-soft">
            <th scope="col" className="px-2 py-2">
              {copy.adminImportExternalRef}
            </th>
            <th scope="col" className="px-2 py-2">
              {copy.adminSlug}
            </th>
            <th scope="col" className="px-2 py-2">
              {copy.adminImportDupOf}
            </th>
            <th scope="col" className="px-2 py-2">
              {copy.adminImportCreateAsNew}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.externalRef} className="border-b border-border-soft align-top">
              <td className="px-2 py-2">{item.externalRef}</td>
              <td className="px-2 py-2">{item.slug ?? "—"}</td>
              <td className="px-2 py-2">{item.duplicateOf ?? "—"}</td>
              <td className="px-2 py-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={copy.adminImportCreateAsNewAck}
                    checked={acknowledged.includes(item.externalRef)}
                    onChange={() => {
                      onToggle(item.externalRef);
                    }}
                    className="h-5 w-5 shrink-0"
                  />
                  <span>{copy.adminImportCreateAsNewAck}</span>
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-muted">{copy.adminImportMergeDisabled}</p>
    </div>
  );
}

function AdvancedSummary({
  copy,
  report,
}: {
  readonly copy: Messages;
  readonly report: ValidationReport;
}): ReactNode {
  return (
    <details className="mt-4 rounded-xl border border-border-soft p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">
        {copy.adminImportViewValidationJob}: {report.jobId}
      </summary>
      <dl className="mt-2">
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportValidCount}</dt>
          <dd>{report.validRecords}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportInvalidCount}</dt>
          <dd>{report.invalidRecords}</dd>
        </div>
      </dl>
    </details>
  );
}

interface IssuesStageProps {
  readonly acknowledged: ReadonlyArray<string>;
  readonly allAcked: boolean;
  readonly copy: Messages;
  readonly duplicateItems: ReadonlyArray<ValidationItem>;
  readonly invalidItems: ReadonlyArray<ValidationItem>;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onToggleDuplicate: (externalRef: string) => void;
  readonly report: ValidationReport | null;
}

export function IssuesStage({
  acknowledged,
  allAcked,
  copy,
  duplicateItems,
  invalidItems,
  onBack,
  onContinue,
  onToggleDuplicate,
  report,
}: IssuesStageProps): ReactNode {
  return (
    <StageCard label={copy.adminStageIssues} title={copy.adminImportStepIssues}>
      {report === null ? (
        <p className="mt-2">{copy.adminImportNoReport}</p>
      ) : (
        <div>
          <p aria-live="polite" className="mt-2 font-semibold">
            {report.validRecords} valid, {report.invalidRecords} invalid, {duplicateItems.length}{" "}
            possible duplicates.
          </p>
          <InvalidRows copy={copy} items={invalidItems} />
          <DuplicateRows
            acknowledged={acknowledged}
            copy={copy}
            items={duplicateItems}
            onToggle={onToggleDuplicate}
          />
          <AdvancedSummary copy={copy} report={report} />
          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-5 font-bold"
              onClick={onBack}
            >
              {copy.adminImportBack}
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white disabled:opacity-50"
              disabled={!allAcked}
              onClick={onContinue}
            >
              {copy.adminImportContinueConfirm}
            </button>
          </ActionFooter>
          {allAcked ? null : <p className="mt-2 text-sm">{copy.adminImportAckAll}</p>}
        </div>
      )}
    </StageCard>
  );
}

interface ConfirmStageProps {
  readonly applyError: boolean;
  readonly applyReady: boolean;
  readonly copy: Messages;
  readonly duplicateCount: number;
  readonly freshStatus: string | null;
  readonly isRefreshing: boolean;
  readonly license: ImportLicense;
  readonly licenseAck: boolean;
  readonly licenseReview: boolean;
  readonly onApply: () => void;
  readonly onBack: () => void;
  readonly onLicenseAck: (checked: boolean) => void;
  readonly onRefresh: () => void;
  readonly onReviewAck: (checked: boolean) => void;
  readonly report: ValidationReport | null;
  readonly reviewAck: boolean;
  readonly sourceName: string;
}

export function ConfirmStage({
  applyError,
  applyReady,
  copy,
  duplicateCount,
  freshStatus,
  isRefreshing,
  license,
  licenseAck,
  licenseReview,
  onApply,
  onBack,
  onLicenseAck,
  onRefresh,
  onReviewAck,
  report,
  reviewAck,
  sourceName,
}: ConfirmStageProps): ReactNode {
  const stale = freshStatus !== null && freshStatus !== "validated" && !isRefreshing;

  return (
    <StageCard label={copy.adminStageConfirm} title={copy.adminImportStepConfirm}>
      {report === null ? (
        <p className="mt-2">{copy.adminImportNoReport}</p>
      ) : (
        <div>
          <dl className="mt-2 rounded-xl border border-border-soft p-4">
            <div className="flex flex-wrap gap-x-2 py-1">
              <dt className="font-semibold">{copy.adminImportValidCount}</dt>
              <dd>{report.validRecords}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 py-1">
              <dt className="font-semibold">{copy.adminImportInvalidSkipped}</dt>
              <dd>{report.invalidRecords}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 py-1">
              <dt className="font-semibold">{copy.adminImportDupCount}</dt>
              <dd>{duplicateCount}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 py-1">
              <dt className="font-semibold">{copy.adminImportSourceRow}</dt>
              <dd>{sourceName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 py-1">
              <dt className="font-semibold">{copy.adminImportLicenseRow}</dt>
              <dd>{license}</dd>
            </div>
          </dl>

          <p aria-live="polite" className="mt-3">
            {copy.adminImportFreshStatus}{" "}
            {isRefreshing
              ? copy.adminImportRefreshingShort
              : (freshStatus ?? copy.adminImportUnknown)}
          </p>

          {stale ? (
            <p role="alert" className="mt-2 font-semibold text-red-700">
              Job {report.jobId} is {freshStatus}, not validated. Apply is refused until the job is
              validated; fix the dataset and run validation again.
            </p>
          ) : null}

          <p className="mt-3">{copy.adminImportReviewNotice}</p>

          {licenseReview ? (
            <AckCheckbox
              id="import-license-ack"
              label={copy.adminImportLicenseAck}
              checked={licenseAck}
              onChange={onLicenseAck}
            />
          ) : null}

          <AckCheckbox
            id="import-review-ack"
            label={copy.adminImportReviewAck}
            checked={reviewAck}
            onChange={onReviewAck}
          />

          {applyError ? (
            <p role="alert" className="mt-2 font-semibold text-red-700">
              {copy.adminImportApplyFailed}
            </p>
          ) : null}

          <ActionFooter>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-5 font-bold"
              onClick={onRefresh}
            >
              {copy.adminImportRefreshStatus}
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-food-orange-strong px-5 font-bold text-white disabled:opacity-50"
              disabled={!applyReady}
              onClick={onApply}
            >
              Apply {report.validRecords} validated records
            </button>
          </ActionFooter>

          <p className="mt-3">
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-5 font-bold"
              onClick={onBack}
            >
              {copy.adminImportBackToIssues}
            </button>
          </p>
        </div>
      )}
    </StageCard>
  );
}
