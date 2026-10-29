import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { ActionFooter, StageCard } from "@/components/admin/import-wizard/chrome";
import { downloadSample, downloadTemplate } from "@/components/admin/import-wizard/helpers";
import { SchemaReference } from "@/components/admin/import-wizard/schema-reference";
import type { DatasetFile } from "@/components/admin/import-wizard/types";
import type { Messages } from "@/shared/i18n";

const formatBytes = (size: number): string => {
  if (size < 1024) {
    return `${size} bytes`;
  }

  return `${(size / 1024).toFixed(1)} KB (${size} bytes)`;
};

interface FileSummaryProps {
  readonly copy: Messages;
  readonly dataset: DatasetFile;
  readonly onClear: () => void;
}

function FileSummary({ copy, dataset, onClear }: FileSummaryProps): ReactNode {
  return (
    <div className="mt-4 rounded-xl border border-border-soft p-4">
      <dl>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileName}</dt>
          <dd className="break-all">{dataset.name}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 py-1">
          <dt className="font-semibold">{copy.adminImportFileSize}</dt>
          <dd>{formatBytes(dataset.size)}</dd>
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
  readonly onClear: () => void;
  readonly onContinue: () => void;
  readonly onFile: (file: File) => void;
  readonly uploadError: string | null;
}

export function UploadStage({
  copy,
  dataset,
  onClear,
  onContinue,
  onFile,
  uploadError,
}: UploadStageProps): ReactNode {
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const openFilePicker = (): void => {
    fileInput.current?.click();
  };

  return (
    <StageCard label={copy.adminStageUpload} title={copy.adminImportStepUpload}>
      <p className="mt-2">{copy.adminImportUploadHint}</p>
      <p className="mt-1 text-sm text-muted">{copy.adminImportPlacesFormat}</p>

      <p className="mt-3 flex flex-wrap gap-2">
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

      {/* Single upload surface: one button handles drag, click/tap browse,
          and keyboard — the native input stays screen-reader-only so there
          is exactly one visible control and never a second "Choose file" row. */}
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
            ? "mt-4 block min-h-24 w-full cursor-pointer rounded-xl border-2 border-dashed border-brand-blue bg-brand-blue/5 p-6 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            : "mt-4 block min-h-24 w-full cursor-pointer rounded-xl border border-dashed border-border-soft p-6 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
        }
      >
        <span id="import-dropzone-hint">
          {dragActive ? copy.adminImportDropActive : copy.adminImportDropHint}
        </span>
      </button>
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

      {uploadError !== null ? (
        <p role="alert" className="mt-2 font-semibold text-red-700">
          {uploadError}
        </p>
      ) : null}

      {dataset !== null ? <FileSummary copy={copy} dataset={dataset} onClear={onClear} /> : null}

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
    </StageCard>
  );
}
