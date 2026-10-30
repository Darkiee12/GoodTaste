import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { ActionFooter, StageCard, StageColumns } from "@/components/admin/import-wizard/chrome";
import { downloadSample, downloadTemplate } from "@/components/admin/import-wizard/helpers";
import { SchemaReference } from "@/components/admin/import-wizard/schema-reference";
import type { DatasetFile } from "@/components/admin/import-wizard/types";
import { GlobalNotification } from "@/components/ui/global-notification";
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_RECORDS } from "@/modules/food-discovery/admin.schema";
import { formatFileSize } from "@/shared/format-file-size";
import type { Locale, Messages } from "@/shared/i18n";

interface FileSummaryProps {
  readonly copy: Messages;
  readonly dataset: DatasetFile;
  readonly lang: Locale;
  readonly onClear: () => void;
}

function FileSummary({ copy, dataset, lang, onClear }: FileSummaryProps): ReactNode {
  const accepted =
    lang === "vi"
      ? `Đã nhận tệp — phát hiện ${dataset.recordCount ?? "?"} bản ghi.`
      : `File accepted — ${dataset.recordCount ?? "?"} records detected.`;

  return (
    <div className="mt-4 max-w-prose rounded-xl border border-border-soft p-4">
      <p aria-live="polite" className="font-semibold text-green-800">
        {accepted}
      </p>
      <dl className="mt-2">
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileName}</dt>
          <dd className="break-all">{dataset.name}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileSize}</dt>
          <dd>{formatFileSize(dataset.size)}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileType}</dt>
          <dd>{dataset.fileType}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileRecords}</dt>
          <dd>
            {dataset.recordCount === null ? copy.adminImportRecordsUnknown : dataset.recordCount}
          </dd>
        </div>
      </dl>
      <p className="mt-3">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center rounded-full border border-border-soft bg-white px-4 text-sm font-semibold hover:bg-cream motion-safe:transition-colors"
        >
          {copy.adminImportRemoveFile}
        </button>
      </p>
    </div>
  );
}

interface UploadStageProps {
  readonly copy: Messages;
  readonly dataset: DatasetFile | null;
  readonly lang: Locale;
  readonly onClear: () => void;
  readonly onContinue: () => void;
  readonly onDismissError: () => void;
  readonly onFile: (file: File) => void;
  readonly oversizeNote: boolean;
  readonly uploadError: string | null;
}

export function UploadStage({
  copy,
  dataset,
  lang,
  onClear,
  onContinue,
  onDismissError,
  onFile,
  oversizeNote,
  uploadError,
}: UploadStageProps): ReactNode {
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const openFilePicker = (): void => {
    fileInput.current?.click();
  };

  const limits = copy.adminImportSchemaLimits
    .replace("{records}", String(MAX_IMPORT_RECORDS))
    .replace("{mb}", formatFileSize(MAX_IMPORT_FILE_BYTES))
    .replace("{bytes}", MAX_IMPORT_FILE_BYTES.toLocaleString());

  const batchedNote =
    lang === "vi"
      ? "Tệp lớn: bước kiểm tra sẽ xử lý theo từng đợt, bạn không cần tự tách tệp."
      : "Large file: validation will process it in batches, so there is no need to split the file by hand.";

  return (
    <StageCard label={copy.adminStageUpload} title={copy.adminImportStepUpload}>
      <StageColumns
        main={
          <div className="min-w-0">
            <p className="mt-2 max-w-prose">{copy.adminImportUploadHint}</p>

            {/* Single upload surface: one button handles drag, click/tap browse,
                and keyboard — the native input stays screen-reader-only so there
                is exactly one visible control and never a second "Choose file" row. */}
            <div className="mt-4 max-w-prose">
              <button
                type="button"
                aria-label={copy.adminImportDropLabel}
                aria-describedby="import-dropzone-hint"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => {
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  const file = event.dataTransfer.files[0];

                  if (file !== undefined) {
                    onFile(file);
                  }
                }}
                onClick={openFilePicker}
                className={
                  dragActive
                    ? "block min-h-24 w-full cursor-pointer rounded-xl border-2 border-dashed border-brand-blue bg-brand-blue/5 p-6 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                    : "block min-h-24 w-full cursor-pointer rounded-xl border border-dashed border-border-soft p-6 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                }
              >
                <span id="import-dropzone-hint">
                  {dragActive ? copy.adminImportDropActive : copy.adminImportDropHint}
                </span>
              </button>
            </div>
            <label htmlFor="import-dataset-file" className="sr-only">
              {copy.adminImportDropLabel}
            </label>
            <input
              ref={fileInput}
              id="import-dataset-file"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file !== undefined) {
                  onFile(file);
                }
              }}
              className="sr-only"
            />

            {oversizeNote && uploadError === null ? (
              <p aria-live="polite" className="mt-2 max-w-prose text-sm font-semibold">
                {batchedNote}
              </p>
            ) : null}

            {/* Blocking upload failure: the assertive banner is the single live
                region (role="alert" lives inside GlobalNotification). The
                field-level hint below carries no role and points at the banner via
                aria-describedby so screen readers announce the failure exactly
                once. The banner persists until dismissed or the file is
                replaced — error banners never auto-dismiss. */}
            {uploadError !== null ? (
              <>
                <GlobalNotification
                  variant="error"
                  title={copy.adminImportUploadFailedTitle}
                  description={uploadError}
                  onClose={onDismissError}
                  closeLabel={copy.adminNotificationDismiss}
                />
                <p
                  id="import-dropzone-error-note"
                  aria-describedby="global-notification"
                  className="mt-2 max-w-prose font-semibold text-red-700"
                >
                  {copy.adminImportFieldErrorNote}
                </p>
              </>
            ) : null}

            {dataset !== null ? (
              <FileSummary copy={copy} dataset={dataset} lang={lang} onClear={onClear} />
            ) : null}

            <ActionFooter>
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white disabled:opacity-50"
                disabled={dataset === null}
                onClick={onContinue}
              >
                {copy.adminImportContinueSource}
              </button>
            </ActionFooter>
          </div>
        }
        aside={
          <div className="min-w-0">
            <h3 className="font-bold">{copy.adminImportSchemaGuideTitle}</h3>
            <p className="mt-2 text-sm text-muted">{limits}</p>
            <p className="mt-2 text-sm text-muted">{copy.adminImportPlacesFormat}</p>
            <p className="mt-3 flex max-w-sm flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full border border-border-soft bg-white px-5 text-sm font-bold text-ink hover:bg-cream motion-safe:transition-colors"
                onClick={downloadTemplate}
              >
                {copy.adminImportDownloadTemplate}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-full border border-border-soft bg-white px-5 text-sm font-bold text-ink hover:bg-cream motion-safe:transition-colors"
                onClick={downloadSample}
              >
                {copy.adminImportDownloadSample}
              </button>
              <SchemaReference copy={copy} />
            </p>
          </div>
        }
      />
    </StageCard>
  );
}
