import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { Option } from "effect";
import { useState } from "react";
import { z } from "zod";

import { StepProgress } from "@/components/admin/import-wizard/chrome";
import {
  countRecords,
  sha256Hex,
  sniffFileType,
  stripBom,
} from "@/components/admin/import-wizard/helpers";
import { ConfirmStage, IssuesStage } from "@/components/admin/import-wizard/review";
import { SourceStage } from "@/components/admin/import-wizard/source-stage";
import { ApplyStage, DoneStage, ValidateStage } from "@/components/admin/import-wizard/stages";
import type {
  ApplyOutcome,
  DatasetFile,
  Stage,
  ValidateOutcome,
} from "@/components/admin/import-wizard/types";
import { validationProgress } from "@/components/admin/import-wizard/types";
import { UploadStage } from "@/components/admin/import-wizard/upload-stage";
import { AdminPageHeader } from "@/components/admin/page-header";
import {
  adminImportApplyBatchFn,
  adminImportApplyFn,
  adminImportBeginFn,
  adminImportJobDetailFn,
  adminImportJobIssuesFn,
  adminImportStageBatchFn,
  adminImportValidateFn,
} from "@/modules/food-discovery/admin.functions";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  csvToRecords,
  jsonToRecords,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import type { ImportLicense, ImportSourceId } from "@/modules/food-discovery/admin.schema";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatFileSize } from "@/shared/format-file-size";
import { messagesFor } from "@/shared/i18n";

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

    const { allowed } = await authorizeFn({
      data: { checks: [{ resource: "food", actions: ["import"] }] },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  component: AdminImportWizard,
});

const freshJobSchema = z.object({
  job: z.object({
    status: z.string(),
  }),
});

/**
 * Stored issue error lists are JSON-encoded string arrays; raw text is a
 * corrupt-envelope fallback, never a silent drop. Module scope: captures
 * nothing from the component closure. Uses Effect's documented safe-parse
 * idiom (Option.liftThrowable over JSON.parse) instead of try/catch.
 */
const safeJsonParse = Option.liftThrowable(JSON.parse);

const errorsOf = (raw: string | null): Array<string> => {
  if (raw === null || raw === "") {
    return [];
  }

  const parsed = safeJsonParse(raw);

  if (Option.isNone(parsed)) {
    return [raw];
  }

  const checked = z.array(z.string()).safeParse(parsed.value);

  return checked.success ? checked.data : [raw];
};

function AdminImportWizard() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const [stage, setStage] = useState<Stage>("upload");
  const [dataset, setDataset] = useState<DatasetFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Large files are not blocked client-side: the batched protocol validates
  // in cursor-driven parts, so the wizard shows an advisory note and lets
  // the server accept (new protocol) or refuse with its reason (old protocol).
  const [oversizeNote, setOversizeNote] = useState(false);
  const [sourceId, setSourceId] = useState<ImportSourceId>("manual");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [license, setLicense] = useState<ImportLicense>("manual-entry");
  const [attribution, setAttribution] = useState("");
  const [editorialNotes, setEditorialNotes] = useState("");
  const [outcome, setOutcome] = useState<ValidateOutcome | null>(null);

  // Batched mode: set once a large dataset finishes staging. The single-shot
  // report shape is synthesized from paged issues so every downstream stage
  // (issues, confirm, apply, done) renders unchanged.
  const [batchedJobId, setBatchedJobId] = useState<string | null>(null);
  const [stageProgress, setStageProgress] = useState<string | null>(null);

  const [acknowledgedDuplicates, setAcknowledgedDuplicates] = useState<ReadonlyArray<string>>([]);

  const [licenseAck, setLicenseAck] = useState(false);
  const [reviewAck, setReviewAck] = useState(false);
  const [freshStatus, setFreshStatus] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyOutcome | null>(null);
  const licenseReview = needsLicenseReview(sourceId, license);

  const goto = (next: Stage): void => {
    setStage(next);
  };

  const loadFile = async (file: File): Promise<void> => {
    setUploadError(null);
    setOversizeNote(false);
    setBatchedJobId(null);
    setStageProgress(null);
    setOutcome(null);
    setApplyResult(null);

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setUploadError(
        copy.adminImportSizeError
          .replace("{actual}", formatFileSize(file.size))
          .replace("{max}", formatFileSize(MAX_IMPORT_FILE_BYTES)),
      );

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

    // Never tell the user to split the file by hand: files over the legacy
    // single-request limit validate in batches once Agent 1's cursor protocol
    // lands, and the Validate stage reports the server's verdict honestly
    // when the old backend still refuses.
    setOversizeNote(recordCount !== null && recordCount > MAX_IMPORT_RECORDS);

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
    mutationFn: async () => {
      if (dataset === null) {
        throw new Error("no dataset loaded");
      }

      const trimmedName = sourceName.trim();

      const source = {
        attribution: attribution.trim() === "" ? undefined : attribution.trim(),
        editorialNotes: editorialNotes.trim() === "" ? undefined : editorialNotes.trim(),
        fileName: dataset.name,
        fileType: dataset.fileType,
        license,
        sourceId,
        sourceName: trimmedName,
        sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
        sourceVersion: sourceVersion.trim() === "" ? undefined : sourceVersion.trim(),
      };

      let records: Array<unknown>;

      try {
        records =
          dataset.fileType === "json"
            ? jsonToRecords(dataset.contentText)
            : csvToRecords(dataset.contentText);
      } catch (error) {
        return {
          ok: false as const,
          reason: error instanceof Error ? error.message : "could not parse dataset file",
        };
      }

      if (records.length <= MAX_IMPORT_RECORDS) {
        setBatchedJobId(null);

        return adminImportValidateFn({
          data: {
            ...source,
            contentText: dataset.contentText,
            fileSize: dataset.size,
          },
        });
      }

      return validateBatched(source, records);
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

  // Large datasets: one logical job, bounded stage batches, then the issues
  // API (not the whole staged set) feeds a single-shot-shaped report so the
  // issues/confirm/apply stages render unchanged. Invalid rows and catalog
  // duplicates are collected from paged queries; valid rows are counted,
  // never loaded in full.
  const validateBatched = async (
    source: {
      readonly attribution?: string;
      readonly editorialNotes?: string;
      readonly fileName: string;
      readonly fileType: "json" | "csv";
      readonly license: ImportLicense;
      readonly sourceId: ImportSourceId;
      readonly sourceName: string;
      readonly sourceUrl?: string;
      readonly sourceVersion?: string;
    },
    records: Array<unknown>,
  ): Promise<ValidateOutcome> => {
    const begun = await adminImportBeginFn({
      data: {
        attribution: source.attribution,
        editorialNotes: source.editorialNotes,
        fileName: source.fileName,
        fileType: source.fileType,
        license: source.license,
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        sourceVersion: source.sourceVersion,
        totalRecords: records.length,
      },
    });

    const jobId = begun.jobId;

    setBatchedJobId(jobId);

    for (let baseIndex = 0; baseIndex < records.length; baseIndex += MAX_IMPORT_RECORDS) {
      setStageProgress(
        lang === "vi"
          ? `Đang kiểm tra ${Math.min(baseIndex + MAX_IMPORT_RECORDS, records.length)}/${records.length} bản ghi…`
          : `Staging records ${Math.min(baseIndex + MAX_IMPORT_RECORDS, records.length)} of ${records.length}…`,
      );

      // eslint-disable-next-line no-await-in-loop -- cursor-driven: each batch starts exactly at the server cursor
      const staged = await adminImportStageBatchFn({
        data: {
          jobId,
          baseIndex,
          records: records.slice(baseIndex, baseIndex + MAX_IMPORT_RECORDS),
        },
      });

      if (
        !staged.complete &&
        staged.stagedCount !== baseIndex + Math.min(MAX_IMPORT_RECORDS, records.length - baseIndex)
      ) {
        throw new Error(
          `stage cursor mismatch at batch ${baseIndex}: server reports ${staged.stagedCount} staged`,
        );
      }
    }

    setStageProgress(null);

    const invalidItems: Array<{
      readonly externalRef: string;
      readonly status: "invalid";
      readonly errors: Array<string>;
      readonly duplicateOf: null;
      readonly slug: string | null;
    }> = [];

    const duplicateItems: Array<{
      readonly externalRef: string;
      readonly status: "valid";
      readonly errors: Array<string>;
      readonly duplicateOf: string;
      readonly slug: string | null;
    }> = [];

    let validRecords = 0;
    let invalidRecords = 0;

    // Invalid rows first (usually few): errors + row order drive the review.
    {
      let cursor = "0";

      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- keyset pages chain on the previous cursor
        const page = await adminImportJobIssuesFn({
          data: { jobId, status: "invalid", limit: 200, cursor },
        });

        for (const row of page.records) {
          invalidItems.push({
            externalRef: row.externalRef,
            status: "invalid" as const,
            errors: errorsOf(row.errors),
            duplicateOf: null,
            slug: row.recordSlug,
          });
        }

        if (page.nextCursor === null) {
          invalidRecords = page.totals.invalid;
          validRecords = page.totals.valid;
          break;
        }

        cursor = page.nextCursor;
      }
    }

    // Valid rows: scan for catalog duplicates (duplicateOf) without keeping
    // the rows. Duplicate acknowledgement then works exactly like the
    // single-shot flow; cross-batch slug collisions are already invalid.
    {
      let cursor = "0";

      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- keyset pages chain on the previous cursor
        const page = await adminImportJobIssuesFn({
          data: { jobId, status: "valid", limit: 200, cursor },
        });

        for (const row of page.records) {
          if (row.duplicateOf !== null) {
            duplicateItems.push({
              externalRef: row.externalRef,
              status: "valid" as const,
              errors: [],
              duplicateOf: row.duplicateOf,
              slug: row.recordSlug,
            });
          }
        }

        if (page.nextCursor === null) {
          break;
        }

        cursor = page.nextCursor;
      }
    }

    return {
      ok: true as const,
      licenseReview,
      report: {
        jobId,
        totalRecords: records.length,
        validRecords,
        invalidRecords,
        items: [...duplicateItems, ...invalidItems],
      },
    };
  };

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
    mutationFn: async (input: {
      jobId: string;
      licenseAck: boolean;
      reviewAck: boolean;
      duplicateRefs: ReadonlyArray<string>;
    }) => {
      if (batchedJobId === null || input.jobId !== batchedJobId) {
        return adminImportApplyFn({
          data: {
            jobId: input.jobId,
            approvals: {
              licenseAck: input.licenseAck,
              reviewAck: input.reviewAck,
              duplicateRefs: [...input.duplicateRefs],
            },
          },
        });
      }

      // Batched apply: bounded calls until the server reports done. The
      // running totals update live on the apply stage; a crash resumes from
      // stored row statuses, never by replaying applied rows.
      let applied = 0;
      let skippedDuplicate = 0;
      let failed = 0;

      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- cursor-driven: each batch resumes from stored row statuses
        const batch = await adminImportApplyBatchFn({
          data: {
            jobId: input.jobId,
            approvals: {
              licenseAck: input.licenseAck,
              reviewAck: input.reviewAck,
              duplicateRefs: [...input.duplicateRefs],
            },
            limit: MAX_IMPORT_RECORDS,
          },
        });

        applied += batch.applied;
        skippedDuplicate += batch.skippedDuplicate;
        failed += batch.failed;

        if (batch.done) {
          return {
            jobId: input.jobId,
            applied,
            skippedDuplicate,
            failed,
            done: true as const,
            pending: 0,
          };
        }

        setApplyResult({
          jobId: input.jobId,
          applied,
          skippedDuplicate,
          failed,
          done: false as const,
          pending: batch.pending,
        });
      }
    },
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
    !validationProgress(report).hasMore &&
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

    if (batchedJobId !== null && report.jobId === batchedJobId) {
      goto("apply");
    }

    applyMutation.mutate({
      jobId: report.jobId,
      licenseAck: !licenseReview || licenseAck,
      reviewAck,
      duplicateRefs: acknowledgedDuplicates,
    });
  };

  const sourceComplete = sourceName.trim().length > 0;

  return (
    <div className="w-full min-w-0 bg-cream text-ink">
      <AdminPageHeader
        lang={lang}
        breadcrumbs={[
          { label: copy.adminWorkspace, to: "/admin", search: { lang } },
          { label: copy.adminImports, to: "/admin/imports", search: { lang } },
          { label: copy.adminImportsNewTitle },
        ]}
        title={copy.adminImportsNewTitle}
        description={copy.adminImportSchemaLifecycle}
      />

      <div className="mt-4 min-w-0">
        <StepProgress copy={copy} stage={stage} />
      </div>

      <div className="mt-6 min-w-0">
        {stage === "upload" ? (
          <UploadStage
            copy={copy}
            dataset={dataset}
            lang={lang}
            uploadError={uploadError}
            oversizeNote={oversizeNote}
            onFile={(file) => {
              void loadFile(file);
            }}
            onClear={() => {
              setDataset(null);
              setUploadError(null);
              setOversizeNote(false);
              setBatchedJobId(null);
              setStageProgress(null);
              setOutcome(null);
              setApplyResult(null);
            }}
            onDismissError={() => {
              setUploadError(null);
            }}
            onContinue={() => {
              goto("source");
            }}
          />
        ) : null}

        {stage === "source" ? (
          <SourceStage
            copy={copy}
            sourceId={sourceId}
            sourceName={sourceName}
            sourceUrl={sourceUrl}
            sourceVersion={sourceVersion}
            license={license}
            attribution={attribution}
            editorialNotes={editorialNotes}
            licenseReview={licenseReview}
            sourceComplete={sourceComplete}
            onSourceId={setSourceId}
            onSourceName={setSourceName}
            onSourceUrl={setSourceUrl}
            onSourceVersion={setSourceVersion}
            onLicense={setLicense}
            onAttribution={setAttribution}
            onEditorialNotes={setEditorialNotes}
            onBack={() => {
              goto("upload");
            }}
            onSubmit={startValidation}
          />
        ) : null}

        {stage === "validate" ? (
          <ValidateStage
            copy={copy}
            lang={lang}
            isPending={validateMutation.isPending}
            isError={validateMutation.isError}
            failureReason={validateReason}
            pendingProgress={stageProgress}
            report={report}
            onBackToSource={() => {
              goto("source");
            }}
            onRetry={() => {
              validateMutation.mutate();
            }}
            // Dormant until the batched protocol lands: the old backend never
            // reports hasMore, so this path only runs when the server starts
            // returning a cursor. Wiring the cursor into the request is then a
            // three-line change in validateMutation (Agent 1 owns the field).
            onContinueValidation={() => {
              validateMutation.mutate();
            }}
            onBackToUpload={() => {
              goto("upload");
            }}
            onContinue={enterConfirm}
          />
        ) : null}

        {stage === "issues" ? (
          <IssuesStage
            copy={copy}
            lang={lang}
            report={report}
            duplicateItems={duplicateItems}
            invalidItems={invalidItems}
            acknowledged={acknowledgedDuplicates}
            allAcked={allDuplicatesAcked}
            onToggleDuplicate={toggleDuplicateAck}
            onBack={() => {
              goto("source");
            }}
            onContinue={enterConfirm}
          />
        ) : null}

        {stage === "confirm" ? (
          <ConfirmStage
            copy={copy}
            lang={lang}
            report={report}
            duplicateCount={duplicateItems.length}
            sourceName={sourceName}
            license={license}
            freshStatus={freshStatus}
            isRefreshing={detailMutation.isPending}
            licenseReview={licenseReview}
            licenseAck={licenseAck}
            reviewAck={reviewAck}
            applyReady={applyReady}
            applyError={applyMutation.isError}
            onLicenseAck={setLicenseAck}
            onReviewAck={setReviewAck}
            onRefresh={() => {
              if (report !== null) {
                detailMutation.mutate(report.jobId);
              }
            }}
            onApply={runApply}
            onBack={() => {
              goto("issues");
            }}
          />
        ) : null}

        {stage === "apply" ? (
          <ApplyStage
            copy={copy}
            lang={lang}
            isPending={applyMutation.isPending}
            applyError={applyMutation.isError}
            applyResult={applyResult}
            onRetry={() => {
              if (report !== null) {
                detailMutation.mutate(report.jobId);
              }

              runApply();
            }}
            onContinueDone={() => {
              goto("done");
            }}
          />
        ) : null}

        {stage === "done" ? (
          <DoneStage
            copy={copy}
            lang={lang}
            applyResult={applyResult}
            validationJobId={report?.jobId ?? null}
          />
        ) : null}
      </div>
    </div>
  );
}
