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

const STAGE_LABELS: ReadonlyArray<{ stage: Stage; label: string }> = [
  { stage: "upload", label: "Upload" },
  { stage: "source", label: "Source" },
  { stage: "validate", label: "Validate" },
  { stage: "issues", label: "Issues" },
  { stage: "confirm", label: "Confirm" },
  { stage: "apply", label: "Apply" },
  { stage: "done", label: "Done" },
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
pho-bo-vietnam,review,,Beef pho,en,localized,Vietnamese beef noodle soup with flat rice noodles.,rice noodles;beef,VN,vietnamese,noodles,Verify ingredients with a local cook.
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
      setUploadError("File is empty.");

      return;
    }

    const raw = await file.text();
    const contentText = stripBom(raw);
    const fileType = sniffFileType(file.name, contentText);

    if (fileType === null) {
      setUploadError("Could not detect a supported type. Upload a .json or .csv dataset file.");

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
    mutationFn: (jobId: string) => adminImportApplyFn({ data: { jobId } }),
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

    applyMutation.mutate(report.jobId);
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
          Back to imports
        </Link>
      </p>

      <h1 className="font-display text-4xl tracking-wide">New dataset import</h1>

      <ol aria-label="Import stages">
        {STAGE_LABELS.map((entry, index) => (
          <li key={entry.stage} aria-current={entry.stage === stage ? "step" : undefined}>
            <span>
              {index + 1}. {entry.label}
            </span>

            {index < stageIndex ? " (done)" : null}
          </li>
        ))}
      </ol>

      {stage === "upload" ? (
        <section aria-label="Upload dataset">
          <h2 className="font-display text-2xl tracking-wide">1. Upload</h2>

          <p>
            Upload a JSON or CSV dataset (max 2 MB, max 100 records). The file stays in this page;
            it is never put in the URL or browser storage.
          </p>

          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              onClick={downloadTemplate}
            >
              Download JSON template
            </button>{" "}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              onClick={downloadSample}
            >
              Download sample CSV
            </button>
          </p>

          <button
            type="button"
            aria-label="Drop a dataset file here, or activate to browse"
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
            {dragActive ? "Drop the file to load it." : "Drag a file here, or activate to browse."}
          </button>

          <label>
            Choose dataset file
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
                <dt>File name</dt>
                <dd>{dataset.name}</dd>
              </div>

              <div>
                <dt>Size</dt>
                <dd>{dataset.size} bytes</dd>
              </div>

              <div>
                <dt>Detected type</dt>
                <dd>{dataset.fileType}</dd>
              </div>

              <div>
                <dt>SHA-256</dt>
                <dd>{dataset.sha256}</dd>
              </div>

              <div>
                <dt>Records detected</dt>
                <dd>
                  {dataset.recordCount === null
                    ? "Could not parse yet; validation will report the problem."
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
              Continue to source
            </button>
          </p>
        </section>
      ) : null}

      {stage === "source" ? (
        <section aria-label="Source and license">
          <h2 className="font-display text-2xl tracking-wide">2. Source</h2>

          <label>
            Source registry
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

          {selectedRegistry !== undefined ? <p>Reuse rule: {selectedRegistry.reuseRule}</p> : null}

          <label>
            Source name
            <input
              value={sourceName}
              onChange={(event) => {
                setSourceName(event.target.value);
              }}
            />
          </label>

          <label>
            Source URL (optional)
            <input
              value={sourceUrl}
              inputMode="url"
              onChange={(event) => {
                setSourceUrl(event.target.value);
              }}
            />
          </label>

          <label>
            Source version (optional)
            <input
              value={sourceVersion}
              onChange={(event) => {
                setSourceVersion(event.target.value);
              }}
            />
          </label>

          <label>
            License
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

          {licenseReview ? (
            <p role="alert">
              License review required: this source and license combination must be reviewed before
              applying. You will confirm this in the Confirm stage.
            </p>
          ) : null}

          <label>
            Attribution (optional)
            <input
              value={attribution}
              onChange={(event) => {
                setAttribution(event.target.value);
              }}
            />
          </label>

          <label>
            Editorial notes (optional)
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
              Back
            </button>{" "}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              disabled={!sourceComplete}
              onClick={startValidation}
            >
              Run validation
            </button>
          </p>

          {!sourceComplete ? <p>Source name is required.</p> : null}
        </section>
      ) : null}

      {stage === "validate" ? (
        <section aria-label="Validation result" aria-live="polite">
          <h2 className="font-display text-2xl tracking-wide">3. Validate</h2>

          {validateMutation.isPending ? <p>Validating the dataset on the server…</p> : null}

          {validateMutation.isError ? (
            <div>
              <p role="alert">The validation request failed. Try again.</p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("source");
                  }}
                >
                  Back to source
                </button>{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={() => {
                    validateMutation.mutate();
                  }}
                >
                  Retry validation
                </button>
              </p>
            </div>
          ) : null}

          {validateReason !== null ? (
            <div>
              <p role="alert">Validation failed: {validateReason}</p>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  onClick={() => {
                    goto("upload");
                  }}
                >
                  Back to upload
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
                  Continue to issues
                </button>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "issues" ? (
        <section aria-label="Validation issues">
          <h2 className="font-display text-2xl tracking-wide">4. Issues</h2>

          {report === null ? (
            <p>No validation report yet. Run validation first.</p>
          ) : (
            <div>
              <p aria-live="polite">
                {report.validRecords} valid, {report.invalidRecords} invalid,{" "}
                {duplicateItems.length} possible duplicates.
              </p>

              {invalidItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <caption>Invalid records (skipped automatically on apply)</caption>

                    <thead>
                      <tr>
                        <th scope="col">External ref</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Errors</th>
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
                <p>No invalid records.</p>
              )}

              {duplicateItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table>
                    <caption>Possible duplicates</caption>

                    <thead>
                      <tr>
                        <th scope="col">External ref</th>
                        <th scope="col">Slug</th>
                        <th scope="col">Possible duplicate of</th>
                        <th scope="col">Create as new dish (goes to review)</th>
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
                              Create as a new dish; it will enter editorial review
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p>
                    Merge or update of the existing dish is disabled in this release: there is no
                    safe merge yet, so duplicates can only be created as new dishes for curators to
                    review.
                  </p>
                </div>
              ) : (
                <p>No duplicate warnings.</p>
              )}

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("source");
                  }}
                >
                  Back
                </button>{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
                  disabled={!allDuplicatesAcked}
                  onClick={enterConfirm}
                >
                  Continue to confirm
                </button>
              </p>

              {!allDuplicatesAcked ? <p>Acknowledge every duplicate before continuing.</p> : null}
            </div>
          )}
        </section>
      ) : null}

      {stage === "confirm" ? (
        <section aria-label="Confirm apply">
          <h2 className="font-display text-2xl tracking-wide">5. Confirm</h2>

          {report === null ? (
            <p>No validation report yet. Run validation first.</p>
          ) : (
            <div>
              <dl>
                <div>
                  <dt>Valid records</dt>
                  <dd>{report.validRecords}</dd>
                </div>

                <div>
                  <dt>Invalid records (skipped on apply)</dt>
                  <dd>{report.invalidRecords}</dd>
                </div>

                <div>
                  <dt>Possible duplicates</dt>
                  <dd>{duplicateItems.length}</dd>
                </div>

                <div>
                  <dt>Source</dt>
                  <dd>{sourceName}</dd>
                </div>

                <div>
                  <dt>License</dt>
                  <dd>{license}</dd>
                </div>
              </dl>

              <p aria-live="polite">
                Fresh job status:{" "}
                {detailMutation.isPending ? "refreshing…" : (freshStatus ?? "unknown")}
              </p>

              {freshStatus !== null && freshStatus !== "validated" && !detailMutation.isPending ? (
                <p role="alert">
                  Job {report.jobId} is {freshStatus}, not validated. Apply is refused until the job
                  is validated; fix the dataset and run validation again.
                </p>
              ) : null}

              <p>
                Applying creates dishes in editorial review only. Nothing enters the public catalog
                until a curator publishes it.
              </p>

              {licenseReview ? (
                <label>
                  <input
                    type="checkbox"
                    checked={licenseAck}
                    onChange={(event) => {
                      setLicenseAck(event.target.checked);
                    }}
                  />
                  I confirm the license for this source has been reviewed
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
                I understand these records enter editorial review, not the public catalog
              </label>

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    detailMutation.mutate(report.jobId);
                  }}
                >
                  Refresh job status
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

              {applyMutation.isError ? (
                <p role="alert">
                  Apply failed. The job may no longer be validated; refresh the job status and try
                  again.
                </p>
              ) : null}

              <p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
                  onClick={() => {
                    goto("issues");
                  }}
                >
                  Back to issues
                </button>
              </p>
            </div>
          )}
        </section>
      ) : null}

      {stage === "apply" ? (
        <section aria-label="Apply result" aria-live="polite">
          <h2 className="font-display text-2xl tracking-wide">6. Apply</h2>

          {applyMutation.isPending ? <p>Applying the import…</p> : null}

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
                  View job detail
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
                  Continue to done
                </button>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "done" ? (
        <section aria-label="Import complete">
          <h2 className="font-display text-2xl tracking-wide">7. Done</h2>

          <p aria-live="polite">
            {applyResult !== null
              ? `Import ${applyResult.jobId} applied: ${applyResult.applied} records in editorial review.`
              : "Import finished."}
          </p>

          {applyResult !== null ? (
            <p>
              <Link
                to="/admin/imports/$jobId"
                params={{ jobId: applyResult.jobId }}
                search={{ lang }}
              >
                View job detail
              </Link>
            </p>
          ) : null}

          {report !== null ? (
            <p>
              <Link to="/admin/imports/$jobId" params={{ jobId: report.jobId }} search={{ lang }}>
                View validation job detail
              </Link>
            </p>
          ) : null}

          <p>
            <Link to="/admin/imports" search={{ lang }}>
              Back to imports
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
