import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";

import {
  adminImportApplyFn,
  adminImportJobDetailFn,
  adminImportValidateFn,
  adminSurfaceFn,
} from "@/modules/food-discovery/admin.functions";
import {
  FEASTJOURNEY_JSON_TEMPLATE,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  SOURCE_REGISTRY,
  csvToRecords,
  jsonToRecords,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import type { ImportLicense, ImportSourceId } from "@/modules/food-discovery/admin.schema";
import { getSessionFn } from "@/modules/user/session.functions";
import { messagesFor, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/imports/new")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/admin/imports/new", lang: search.lang },
      });
    }

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  component: AdminImportWizard,
});

const STAGES = ["upload", "source", "validate", "issues", "confirm", "apply", "done"] as const;

type Stage = (typeof STAGES)[number];

const stageLabels = (copy: Messages): ReadonlyArray<{ stage: Stage; label: string }> => [
  { stage: "upload", label: copy.adminStageUpload },
  { stage: "source", label: copy.adminStageSource },
  { stage: "validate", label: copy.adminStageValidate },
  { stage: "issues", label: copy.adminStageIssues },
  { stage: "confirm", label: copy.adminStageConfirm },
  { stage: "apply", label: copy.adminStageApply },
  { stage: "done", label: copy.adminStageDone },
];

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

const SAMPLE_CSV = `slug,status,parent_slug,name,language_tag,name_kind,description,ingredients,places,cuisines,categories,editorial_note
pho-bo-vietnam,review,,Beef pho,en,localized,Vietnamese beef noodle soup with flat rice noodles.,rice noodles;beef,VN:origin;FR:popular,vietnamese,noodles,Verify ingredients with a local cook.
`;

interface DatasetFile {
  readonly contentText: string;
  readonly fileType: "json" | "csv";
  readonly name: string;
  readonly recordCount: number | null;
  readonly sha256: string;
  readonly size: number;
}

type ValidateOutcome = Awaited<ReturnType<typeof adminImportValidateFn>>;

type ApplyOutcome = Awaited<ReturnType<typeof adminImportApplyFn>>;

const stripBom = (text: string): string => {
  if (text.startsWith("﻿")) {
    return text.slice(1);
  }

  return text;
};

const sniffFileType = (name: string, text: string): "json" | "csv" | null => {
  const lower = name.toLowerCase();

  if (lower.endsWith(".json")) {
    return "json";
  }

  if (lower.endsWith(".csv")) {
    return "csv";
  }

  const trimmed = text.trimStart();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(text);
    } catch {
      return null;
    }

    return "json";
  }

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";

  if (firstLine.toLowerCase().includes("name")) {
    return "csv";
  }

  return null;
};

const countRecords = (fileType: "json" | "csv", text: string): number | null => {
  try {
    const records = fileType === "json" ? jsonToRecords(text) : csvToRecords(text);

    return records.length;
  } catch {
    return null;
  }
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const downloadText = (filename: string, text: string, mime: string): void => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const downloadTemplate = (): void => {
  downloadText("feastjourney-template.json", FEASTJOURNEY_JSON_TEMPLATE, "application/json");
};

const downloadSample = (): void => {
  downloadText("feastjourney-sample.csv", SAMPLE_CSV, "text/csv");
};

const freshJobSchema = z.object({
  job: z.object({
    status: z.string(),
  }),
});

function AdminImportWizard() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [dataset, setDataset] = useState<DatasetFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sourceId, setSourceId] = useState<ImportSourceId>("manual");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [license, setLicense] = useState<ImportLicense>("manual-entry");
  const [attribution, setAttribution] = useState("");
  const [editorialNotes, setEditorialNotes] = useState("");
  const [outcome, setOutcome] = useState<ValidateOutcome | null>(null);

  const [acknowledgedDuplicates, setAcknowledgedDuplicates] = useState<ReadonlyArray<string>>([]);

  const [licenseAck, setLicenseAck] = useState(false);
  const [reviewAck, setReviewAck] = useState(false);
  const [freshStatus, setFreshStatus] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyOutcome | null>(null);
  const licenseReview = needsLicenseReview(sourceId, license);
  const stageIndex = STAGES.indexOf(stage);

  const goto = (next: Stage): void => {
    setStage(next);
  };

  const loadFile = async (file: File): Promise<void> => {
    setUploadError(null);

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setUploadError(`File is ${file.size} bytes; the limit is ${MAX_IMPORT_FILE_BYTES} bytes.`);

      return;
    }

    if (file.size === 0) {
      setUploadError(copy.adminImportFileEmpty);

      return;
    }

    const raw = await file.text();
    const contentText = stripBom(raw);
    const fileType = sniffFileType(file.name, contentText);

    if (fileType === null) {
      setUploadError(copy.adminImportTypeUnknown);

      return;
    }

    const recordCount = countRecords(fileType, contentText);

    if (recordCount !== null && recordCount > MAX_IMPORT_RECORDS) {
      setUploadError(
        `Dataset has ${recordCount} records; at most ${MAX_IMPORT_RECORDS} per import job.`,
      );

      return;
    }

    const sha256 = await sha256Hex(contentText);

    setDataset({
      contentText,
      fileType,
      name: file.name,
      recordCount,
      sha256,
      size: file.size,
    });
  };

  const validateMutation = useMutation({
    mutationFn: () => {
      if (dataset === null) {
        throw new Error("no dataset loaded");
      }

      return adminImportValidateFn({
        data: {
          attribution: attribution.trim() === "" ? undefined : attribution.trim(),
          contentText: dataset.contentText,
          editorialNotes: editorialNotes.trim() === "" ? undefined : editorialNotes.trim(),
          fileName: dataset.name,
          fileSize: dataset.size,
          fileType: dataset.fileType,
          license,
          sourceId,
          sourceName: sourceName.trim(),
          sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
          sourceVersion: sourceVersion.trim() === "" ? undefined : sourceVersion.trim(),
        },
      });
    },
    onSuccess: (result) => {
      setOutcome(result);
      setFreshStatus(null);
      setApplyResult(null);
      setAcknowledgedDuplicates([]);
      setLicenseAck(false);
      setReviewAck(false);

      if (result.ok) {
        goto("issues");
      }
    },
  });

  const detailMutation = useMutation({
    mutationFn: (jobId: string) => adminImportJobDetailFn({ data: { jobId, recordLimit: 100 } }),
    onSuccess: (fresh) => {
      const raw: unknown = fresh;
      const parsed = freshJobSchema.safeParse(raw);

      if (parsed.success) {
        setFreshStatus(parsed.data.job.status);
      } else {
        setFreshStatus(null);
      }
    },
  });

  const applyMutation = useMutation({
    mutationFn: (input: {
      jobId: string;
      licenseAck: boolean;
      reviewAck: boolean;
      duplicateRefs: ReadonlyArray<string>;
    }) =>
      adminImportApplyFn({
        data: {
          jobId: input.jobId,
          approvals: {
            licenseAck: input.licenseAck,
            reviewAck: input.reviewAck,
            duplicateRefs: [...input.duplicateRefs],
          },
        },
      }),
    onSuccess: (result) => {
      setApplyResult(result);
      goto("apply");
    },
  });

  const report = outcome !== null && outcome.ok ? outcome.report : null;
  const validateReason = outcome !== null && !outcome.ok ? outcome.reason : null;

  const duplicateItems =
    report !== null
      ? report.items.filter((item) => item.duplicateOf !== null && item.status === "valid")
      : [];

  const invalidItems =
    report !== null ? report.items.filter((item) => item.status === "invalid") : [];

  const allDuplicatesAcked = duplicateItems.every((item) =>
    acknowledgedDuplicates.includes(item.externalRef),
  );

  const applyReady =
    report !== null &&
    freshStatus === "validated" &&
    allDuplicatesAcked &&
    (!licenseReview || licenseAck) &&
    reviewAck &&
    !applyMutation.isPending;

  const toggleDuplicateAck = (externalRef: string): void => {
    if (acknowledgedDuplicates.includes(externalRef)) {
      setAcknowledgedDuplicates(acknowledgedDuplicates.filter((entry) => entry !== externalRef));
    } else {
      setAcknowledgedDuplicates([...acknowledgedDuplicates, externalRef]);
    }
  };

  const startValidation = (): void => {
    setOutcome(null);
    goto("validate");
    validateMutation.mutate();
  };

  const enterConfirm = (): void => {
    goto("confirm");

    if (report !== null) {
      detailMutation.mutate(report.jobId);
    }
  };

  const runApply = (): void => {
    if (report === null || freshStatus !== "validated") {
      return;
    }

    applyMutation.mutate({
      jobId: report.jobId,
      licenseAck: !licenseReview || licenseAck,
      reviewAck,
      duplicateRefs: acknowledgedDuplicates,
    });
  };

  const openFilePicker = (): void => {
    fileInput.current?.click();
  };

  const sourceComplete = sourceName.trim().length > 0;
  const selectedRegistry = SOURCE_REGISTRY.find((entry) => entry.id === sourceId);

  const selectSourceId = (value: string): void => {
    const next = SOURCE_REGISTRY.find((entry) => entry.id === value);

    if (next !== undefined) {
      setSourceId(next.id);
    }
  };

  const selectLicense = (value: string): void => {
    const next = LICENSES.find((entry) => entry === value);

    if (next !== undefined) {
      setLicense(next);
    }
  };

  return (
    <div className="bg-cream min-h-screen text-ink">
      <p>
        <Link to="/admin/imports" search={{ lang }}>
          {copy.adminImportBackToImports}
        </Link>
      </p>

      <h1 className="font-display text-4xl tracking-wide">{copy.adminImportsNewTitle}</h1>

      <ol aria-label={copy.adminImportStagesLabel}>
        {stageLabels(copy).map((entry, index) => (
          <li key={entry.stage} aria-current={entry.stage === stage ? "step" : undefined}>
            <span>
              {index + 1}. {entry.label}
            </span>

            {index < stageIndex ? copy.adminImportDoneSuffix : null}
          </li>
        ))}
      </ol>

      {stage === "upload" ? (
        <section aria-label={copy.adminStageUpload}>
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepUpload}</h2>

          <p>{copy.adminImportUploadHint}</p>

          <p>{copy.adminImportPlacesFormat}</p>

          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              onClick={downloadTemplate}
            >
              {copy.adminImportDownloadTemplate}
            </button>{" "}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              onClick={downloadSample}
            >
              {copy.adminImportDownloadSample}
            </button>
          </p>

          <button
            type="button"
            aria-label={copy.adminImportDropLabel}
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
                void loadFile(file);
              }
            }}
            onClick={openFilePicker}
            className={dragActive ? "border-2 border-dashed" : "border"}
          >
            {dragActive ? copy.adminImportDropActive : copy.adminImportDropHint}
          </button>

          <label>
            {copy.adminImportChooseFile}
            <input
              ref={fileInput}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file !== undefined) {
                  void loadFile(file);
                }
              }}
            />
          </label>

          {uploadError !== null ? <p role="alert">{uploadError}</p> : null}

          {dataset !== null ? (
            <dl>
              <div>
                <dt>{copy.adminImportFileName}</dt>
                <dd>{dataset.name}</dd>
              </div>

              <div>
                <dt>{copy.adminImportFileSize}</dt>
                <dd>{dataset.size} bytes</dd>
              </div>

              <div>
                <dt>{copy.adminImportFileType}</dt>
                <dd>{dataset.fileType}</dd>
              </div>

              <div>
                <dt>{copy.adminImportFileSha}</dt>
                <dd>{dataset.sha256}</dd>
              </div>

              <div>
                <dt>{copy.adminImportFileRecords}</dt>
                <dd>
                  {dataset.recordCount === null
                    ? copy.adminImportRecordsUnknown
                    : dataset.recordCount}
                </dd>
              </div>
            </dl>
          ) : null}

          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              disabled={dataset === null}
              onClick={() => {
                goto("source");
              }}
            >
              {copy.adminImportContinueSource}
            </button>
          </p>
        </section>
      ) : null}

      {stage === "source" ? (
        <section aria-label={copy.adminStageSource}>
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepSource}</h2>

          <label>
            {copy.adminImportSourceRegistry}
            <select
              value={sourceId}
              onChange={(event) => {
                selectSourceId(event.target.value);
              }}
            >
              {SOURCE_REGISTRY.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {selectedRegistry !== undefined ? (
            <p>
              {copy.adminImportReuseRule} {selectedRegistry.reuseRule}
            </p>
          ) : null}

          <label>
            {copy.adminImportSourceName}
            <input
              value={sourceName}
              onChange={(event) => {
                setSourceName(event.target.value);
              }}
            />
          </label>

          <label>
            {copy.adminImportSourceUrlField}
            <input
              value={sourceUrl}
              inputMode="url"
              onChange={(event) => {
                setSourceUrl(event.target.value);
              }}
            />
          </label>

          <label>
            {copy.adminImportSourceVersionField}
            <input
              value={sourceVersion}
              onChange={(event) => {
                setSourceVersion(event.target.value);
              }}
            />
          </label>

          <label>
            {copy.adminLicense}
            <select
              value={license}
              onChange={(event) => {
                selectLicense(event.target.value);
              }}
            >
              {LICENSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          {licenseReview ? <p role="alert">{copy.adminImportLicenseReview}</p> : null}

          <label>
            {copy.adminImportAttributionField}
            <input
              value={attribution}
              onChange={(event) => {
                setAttribution(event.target.value);
              }}
            />
          </label>

          <label>
            {copy.adminImportEditorialNotesField}
            <textarea
              value={editorialNotes}
              onChange={(event) => {
                setEditorialNotes(event.target.value);
              }}
            />
          </label>

          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              onClick={() => {
                goto("upload");
              }}
            >
              {copy.adminImportBack}
            </button>{" "}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              disabled={!sourceComplete}
              onClick={startValidation}
            >
              {copy.adminImportRunValidation}
            </button>
          </p>

          {!sourceComplete ? <p>{copy.adminImportSourceRequired}</p> : null}
        </section>
      ) : null}

      {stage === "validate" ? (
        <section aria-label={copy.adminStageValidate} aria-live="polite">
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepValidate}</h2>

          {validateMutation.isPending ? <p>{copy.adminImportValidating}</p> : null}

          {validateMutation.isError ? (
            <div>
              <p role="alert">{copy.adminImportValidateFailed}</p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("source");
                  }}
                >
                  {copy.adminImportBackToSource}
                </button>{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={() => {
                    validateMutation.mutate();
                  }}
                >
                  {copy.adminImportRetryValidation}
                </button>
              </p>
            </div>
          ) : null}

          {validateReason !== null ? (
            <div>
              <p role="alert">
                {copy.adminImportValidationFailedPrefix} {validateReason}
              </p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={() => {
                    goto("upload");
                  }}
                >
                  {copy.adminImportBackToUpload}
                </button>
              </p>
            </div>
          ) : null}

          {report !== null ? (
            <div>
              <p>
                Job {report.jobId}: {report.totalRecords} total, {report.validRecords} valid,{" "}
                {report.invalidRecords} invalid.
              </p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={enterConfirm}
                >
                  {copy.adminImportContinueIssues}
                </button>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "issues" ? (
        <section aria-label={copy.adminStageIssues}>
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepIssues}</h2>

          {report === null ? (
            <p>{copy.adminImportNoReport}</p>
          ) : (
            <div>
              <p aria-live="polite">
                {report.validRecords} valid, {report.invalidRecords} invalid,{" "}
                {duplicateItems.length} possible duplicates.
              </p>

              {invalidItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <caption>{copy.adminImportInvalidCaption}</caption>

                    <thead>
                      <tr>
                        <th scope="col">{copy.adminImportExternalRef}</th>
                        <th scope="col">{copy.adminSlug}</th>
                        <th scope="col">{copy.adminImportErrorsCol}</th>
                      </tr>
                    </thead>

                    <tbody>
                      {invalidItems.map((item) => (
                        <tr key={item.externalRef}>
                          <td>{item.externalRef}</td>
                          <td>{item.slug ?? "—"}</td>
                          <td>{item.errors.join(" | ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>{copy.adminImportNoInvalid}</p>
              )}

              {duplicateItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <caption>{copy.adminImportDuplicatesCaption}</caption>

                    <thead>
                      <tr>
                        <th scope="col">{copy.adminImportExternalRef}</th>
                        <th scope="col">{copy.adminSlug}</th>
                        <th scope="col">{copy.adminImportDupOf}</th>
                        <th scope="col">{copy.adminImportCreateAsNew}</th>
                      </tr>
                    </thead>

                    <tbody>
                      {duplicateItems.map((item) => (
                        <tr key={item.externalRef}>
                          <td>{item.externalRef}</td>
                          <td>{item.slug ?? "—"}</td>
                          <td>{item.duplicateOf ?? "—"}</td>
                          <td>
                            <label>
                              <input
                                type="checkbox"
                                checked={acknowledgedDuplicates.includes(item.externalRef)}
                                onChange={() => {
                                  toggleDuplicateAck(item.externalRef);
                                }}
                              />
                              {copy.adminImportCreateAsNewAck}
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p>{copy.adminImportMergeDisabled}</p>
                </div>
              ) : (
                <p>{copy.adminImportNoDuplicates}</p>
              )}

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("source");
                  }}
                >
                  {copy.adminImportBack}
                </button>{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  disabled={!allDuplicatesAcked}
                  onClick={enterConfirm}
                >
                  {copy.adminImportContinueConfirm}
                </button>
              </p>

              {!allDuplicatesAcked ? <p>{copy.adminImportAckAll}</p> : null}
            </div>
          )}
        </section>
      ) : null}

      {stage === "confirm" ? (
        <section aria-label={copy.adminStageConfirm}>
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepConfirm}</h2>

          {report === null ? (
            <p>{copy.adminImportNoReport}</p>
          ) : (
            <div>
              <dl>
                <div>
                  <dt>{copy.adminImportValidCount}</dt>
                  <dd>{report.validRecords}</dd>
                </div>

                <div>
                  <dt>{copy.adminImportInvalidSkipped}</dt>
                  <dd>{report.invalidRecords}</dd>
                </div>

                <div>
                  <dt>{copy.adminImportDupCount}</dt>
                  <dd>{duplicateItems.length}</dd>
                </div>

                <div>
                  <dt>{copy.adminImportSourceRow}</dt>
                  <dd>{sourceName}</dd>
                </div>

                <div>
                  <dt>{copy.adminImportLicenseRow}</dt>
                  <dd>{license}</dd>
                </div>
              </dl>

              <p aria-live="polite">
                {copy.adminImportFreshStatus}{" "}
                {detailMutation.isPending
                  ? copy.adminImportRefreshingShort
                  : (freshStatus ?? copy.adminImportUnknown)}
              </p>

              {freshStatus !== null && freshStatus !== "validated" && !detailMutation.isPending ? (
                <p role="alert">
                  Job {report.jobId} is {freshStatus}, not validated. Apply is refused until the job
                  is validated; fix the dataset and run validation again.
                </p>
              ) : null}

              <p>{copy.adminImportReviewNotice}</p>

              {licenseReview ? (
                <label>
                  <input
                    type="checkbox"
                    checked={licenseAck}
                    onChange={(event) => {
                      setLicenseAck(event.target.checked);
                    }}
                  />
                  {copy.adminImportLicenseAck}
                </label>
              ) : null}

              <label>
                <input
                  type="checkbox"
                  checked={reviewAck}
                  onChange={(event) => {
                    setReviewAck(event.target.checked);
                  }}
                />
                {copy.adminImportReviewAck}
              </label>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    detailMutation.mutate(report.jobId);
                  }}
                >
                  {copy.adminImportRefreshStatus}
                </button>{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-food-orange-strong px-5 font-bold text-white"
                  disabled={!applyReady}
                  onClick={runApply}
                >
                  Apply {report.validRecords} validated records
                </button>
              </p>

              {applyMutation.isError ? <p role="alert">{copy.adminImportApplyFailed}</p> : null}

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("issues");
                  }}
                >
                  {copy.adminImportBackToIssues}
                </button>
              </p>
            </div>
          )}
        </section>
      ) : null}

      {stage === "apply" ? (
        <section aria-label={copy.adminStageApply} aria-live="polite">
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepApply}</h2>

          {applyMutation.isPending ? <p>{copy.adminImportApplying}</p> : null}

          {applyResult !== null ? (
            <div>
              <p>
                Job {applyResult.jobId}: {applyResult.applied} applied,{" "}
                {applyResult.skippedDuplicate} skipped duplicates, {applyResult.failed} failed.
              </p>

              <p>
                <Link
                  to="/admin/imports/$jobId"
                  params={{ jobId: applyResult.jobId }}
                  search={{ lang }}
                >
                  {copy.adminImportViewJob}
                </Link>
              </p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={() => {
                    goto("done");
                  }}
                >
                  {copy.adminImportContinueDone}
                </button>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "done" ? (
        <section aria-label={copy.adminStageDone}>
          <h2 className="font-display text-2xl tracking-wide">{copy.adminImportStepDone}</h2>

          <p aria-live="polite">
            {applyResult !== null
              ? `Import ${applyResult.jobId} applied: ${applyResult.applied} records in editorial review.`
              : copy.adminImportFinished}
          </p>

          {applyResult !== null ? (
            <p>
              <Link
                to="/admin/imports/$jobId"
                params={{ jobId: applyResult.jobId }}
                search={{ lang }}
              >
                {copy.adminImportViewJob}
              </Link>
            </p>
          ) : null}

          {report !== null ? (
            <p>
              <Link to="/admin/imports/$jobId" params={{ jobId: report.jobId }} search={{ lang }}>
                {copy.adminImportViewValidationJob}
              </Link>
            </p>
          ) : null}

          <p>
            <Link to="/admin/imports" search={{ lang }}>
              {copy.adminImportBackToImports}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
