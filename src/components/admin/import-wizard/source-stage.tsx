import type { ReactNode } from "react";

import { ActionFooter, StageCard, StageColumns } from "@/components/admin/import-wizard/chrome";
import { SelectField, TextAreaField, TextField } from "@/components/admin/import-wizard/fields";
import { SOURCE_REGISTRY } from "@/modules/food-discovery/admin.schema";
import type { ImportLicense, ImportSourceId } from "@/modules/food-discovery/admin.schema";
import type { Messages } from "@/shared/i18n";

const LICENSES: ReadonlyArray<ImportLicense> = [
  "manual-entry",
  "partner-agreement",
  "permission-granted",
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "unknown",
  "other",
];

interface SourceStageProps {
  readonly attribution: string;
  readonly copy: Messages;
  readonly editorialNotes: string;
  readonly license: ImportLicense;
  readonly licenseReview: boolean;
  readonly onAttribution: (value: string) => void;
  readonly onBack: () => void;
  readonly onEditorialNotes: (value: string) => void;
  readonly onLicense: (value: ImportLicense) => void;
  readonly onSourceId: (value: ImportSourceId) => void;
  readonly onSourceName: (value: string) => void;
  readonly onSourceUrl: (value: string) => void;
  readonly onSourceVersion: (value: string) => void;
  readonly onSubmit: () => void;
  readonly sourceComplete: boolean;
  readonly sourceId: ImportSourceId;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly sourceVersion: string;
}

export function SourceStage({
  attribution,
  copy,
  editorialNotes,
  license,
  licenseReview,
  onAttribution,
  onBack,
  onEditorialNotes,
  onLicense,
  onSourceId,
  onSourceName,
  onSourceUrl,
  onSourceVersion,
  onSubmit,
  sourceComplete,
  sourceId,
  sourceName,
  sourceUrl,
  sourceVersion,
}: SourceStageProps): ReactNode {
  const selectedRegistry = SOURCE_REGISTRY.find((entry) => entry.id === sourceId);

  const selectSourceId = (value: string): void => {
    const next = SOURCE_REGISTRY.find((entry) => entry.id === value);

    if (next !== undefined) {
      onSourceId(next.id);
    }
  };

  const selectLicense = (value: string): void => {
    const next = LICENSES.find((entry) => entry === value);

    if (next !== undefined) {
      onLicense(next);
    }
  };

  return (
    <StageCard label={copy.adminStageSource} title={copy.adminImportStepSource}>
      <StageColumns
        main={
          <div className="min-w-0">
            <div className="max-w-prose">
              <SelectField
                id="import-source-registry"
                label={copy.adminImportSourceRegistry}
                value={sourceId}
                onChange={selectSourceId}
                options={SOURCE_REGISTRY.map((entry) => ({ label: entry.label, value: entry.id }))}
              />

              {selectedRegistry !== undefined ? (
                <p className="mt-2 text-sm text-muted">
                  {copy.adminImportReuseRule} {selectedRegistry.reuseRule}
                </p>
              ) : null}

              <TextField
                id="import-source-name"
                label={copy.adminImportSourceName}
                value={sourceName}
                onChange={onSourceName}
                required
              />

              <TextField
                id="import-source-url"
                label={copy.adminImportSourceUrlField}
                value={sourceUrl}
                onChange={onSourceUrl}
                inputMode="url"
              />

              <TextField
                id="import-source-version"
                label={copy.adminImportSourceVersionField}
                value={sourceVersion}
                onChange={onSourceVersion}
              />

              <SelectField
                id="import-license"
                label={copy.adminLicense}
                value={license}
                onChange={selectLicense}
                options={LICENSES.map((entry) => ({ label: entry, value: entry }))}
              />

              {licenseReview ? (
                <p role="alert" className="mt-2 font-semibold text-amber-700">
                  {copy.adminImportLicenseReview}
                </p>
              ) : null}

              <TextField
                id="import-attribution"
                label={copy.adminImportAttributionField}
                value={attribution}
                onChange={onAttribution}
              />

              <TextAreaField
                id="import-editorial-notes"
                label={copy.adminImportEditorialNotesField}
                value={editorialNotes}
                onChange={onEditorialNotes}
              />
            </div>

            <div className="max-w-prose">
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
                  disabled={!sourceComplete}
                  onClick={onSubmit}
                >
                  {copy.adminImportRunValidation}
                </button>
              </ActionFooter>

              {sourceComplete ? null : (
                <p className="mt-2 text-sm">{copy.adminImportSourceRequired}</p>
              )}
            </div>
          </div>
        }
        aside={
          <div className="min-w-0">
            <h3 className="font-bold">{copy.adminImportSourceRegistry}</h3>
            <p className="mt-2 max-w-prose text-sm text-muted">{copy.adminImportSchemaLifecycle}</p>
            <p className="mt-2 max-w-prose text-sm text-muted">{copy.adminImportReviewNotice}</p>
            {licenseReview ? (
              <p className="mt-2 max-w-prose text-sm font-semibold text-amber-700">
                {copy.adminImportLicenseReview}
              </p>
            ) : null}
          </div>
        }
      />
    </StageCard>
  );
}
