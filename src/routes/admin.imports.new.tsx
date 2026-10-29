import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, redirect } from "@tanstack/react-router";
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
import { UploadStage } from "@/components/admin/import-wizard/upload-stage";
import {
  adminImportApplyFn,
  adminImportJobDetailFn,
  adminImportValidateFn,
} from "@/modules/food-discovery/admin.functions";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import type { ImportLicense, ImportSourceId } from "@/modules/food-discovery/admin.schema";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
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

function AdminImportWizard() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const [stage, setStage] = useState<Stage>("upload");
  const [dataset, setDataset] = useState<DatasetFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  const sourceComplete = sourceName.trim().length > 0;

  return (
    <div className="bg-cream text-ink">
      <p>
        <Link to="/admin/imports" search={{ lang }}>
          {copy.adminImportBackToImports}
        </Link>
      </p>

      <h1 className="font-display text-4xl tracking-wide">{copy.adminImportsNewTitle}</h1>

      <StepProgress copy={copy} stage={stage} />

      {stage === "upload" ? (
        <UploadStage
          copy={copy}
          dataset={dataset}
          uploadError={uploadError}
          onFile={(file) => {
            void loadFile(file);
          }}
          onClear={() => {
            setDataset(null);
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
          isPending={validateMutation.isPending}
          isError={validateMutation.isError}
          failureReason={validateReason}
          report={report}
          onBackToSource={() => {
            goto("source");
          }}
          onRetry={() => {
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
          applyResult={applyResult}
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
  );
}
