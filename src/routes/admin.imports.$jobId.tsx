import { createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { ProgressBar } from "@/components/admin/import-wizard/chrome";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ImportStatusBadge } from "@/components/admin/ui";
import { adminImportJobDetailFn } from "@/modules/food-discovery/admin.functions";
import { importJobStatusSchema } from "@/modules/food-discovery/admin.schema";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatAdminDateTime } from "@/shared/format";
import { messagesFor, type Locale } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const RECORD_LIMIT = 100;
const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 5000;

export const Route = createFileRoute("/admin/imports/$jobId")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/admin/imports", lang: search.lang },
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
  loader: async ({ params }) =>
    adminImportJobDetailFn({ data: { jobId: params.jobId, recordLimit: RECORD_LIMIT } }),
  errorComponent: AdminImportDetailError,
  component: AdminImportDetail,
});

const importJobSchema = z.object({
  attribution: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  dry_run: z.boolean(),
  editorial_notes: z.string().nullable(),
  format: z.union([z.literal("csv"), z.literal("json")]),
  id: z.string(),
  invalid_records: z.number(),
  license: z.string().nullable(),
  source_name: z.string(),
  source_url: z.string().nullable(),
  source_version: z.string().nullable(),
  status: importJobStatusSchema,
  total_records: z.number(),
  valid_records: z.number(),
});

const importRecordSchema = z.object({
  created_at: z.string(),
  dish_id: z.string().nullable(),
  errors: z.string().nullable(),
  external_ref: z.string(),
  id: z.string(),
  job_id: z.string(),
  payload: z.string(),
  status: z.union([
    z.literal("applied"),
    z.literal("invalid"),
    z.literal("pending"),
    z.literal("skipped_duplicate"),
    z.literal("valid"),
  ]),
});

const jobDetailSchema = z.object({
  job: importJobSchema,
  records: z.array(importRecordSchema),
});

type JobDetail = z.infer<typeof jobDetailSchema>;

type JobRecord = z.infer<typeof importRecordSchema>;

const errorsSchema = z.array(z.string());

const payloadNameSchema = z.object({
  record: z.object({
    names: z.array(z.object({ name: z.string() })),
  }),
});

type CellValue = string | number | boolean | null;

const cellText = (value: CellValue): string => {
  if (value === null) {
    return "—";
  }

  return String(value);
};

interface DecodedJson {
  readonly value: unknown;
}

const decodeJson = (text: string): DecodedJson => {
  try {
    const value: unknown = JSON.parse(text);

    return { value };
  } catch {
    return { value: null };
  }
};

const parseErrors = (errors: string | null): ReadonlyArray<string> => {
  if (errors === null || errors === "") {
    return [];
  }

  const decoded = errorsSchema.safeParse(decodeJson(errors).value);

  if (decoded.success) {
    return decoded.data;
  }

  return [errors];
};

/** Prefix a single quote when a CSV cell could be interpreted as a formula. */
const escapeCsvCell = (value: string): string => {
  const needsGuard =
    value.startsWith("=") ||
    value.startsWith("+") ||
    value.startsWith("-") ||
    value.startsWith("@") ||
    value.startsWith("\t") ||
    value.startsWith("\r");

  const guarded = needsGuard ? `'${value}` : value;

  if (
    guarded.includes('"') ||
    guarded.includes(",") ||
    guarded.includes("\n") ||
    guarded.includes("\r")
  ) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }

  return guarded;
};

const buildFailureCsv = (detail: JobDetail): string => {
  const lines: Array<string> = ["external_ref,status,errors,dish_id"];

  for (const record of detail.records) {
    const failures = parseErrors(record.errors);

    if (failures.length === 0) {
      continue;
    }

    const cells = [
      record.external_ref,
      record.status,
      failures.join(" | "),
      cellText(record.dish_id),
    ];

    lines.push(cells.map(escapeCsvCell).join(","));
  }

  return lines.join("\r\n");
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

const payloadSummary = (payloadText: string): string => {
  if (payloadText === "") {
    return "—";
  }

  const raw: unknown = decodeJson(payloadText).value;
  const decoded = payloadNameSchema.safeParse(raw);

  if (!decoded.success) {
    return payloadText.slice(0, 200);
  }

  const first = decoded.data.record.names[0];

  if (first === undefined) {
    return payloadText.slice(0, 200);
  }

  return first.name;
};

const countByStatus = (records: ReadonlyArray<JobRecord>, status: JobRecord["status"]): number =>
  records.filter((record) => record.status === status).length;

const jobProgressExtensionSchema = z
  .object({
    job: z.object({ processed_records: z.number().optional() }).passthrough(),
  })
  .passthrough();

/**
 * Defensive read of Agent 1's batched progress fields. The loader
 * schema strips unknown keys, so extensions are parsed from the raw
 * payload at this boundary: when the server reports `processed_records`,
 * the progress section uses it; otherwise it falls back to record counts.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the raw loader payload is untyped by design; jobProgressExtensionSchema parses it at this boundary and ignores unknown keys.
const readProcessedRecords = (loaded: unknown): number | null => {
  const parsed = jobProgressExtensionSchema.safeParse(loaded);

  if (!parsed.success) {
    return null;
  }

  const value = parsed.data.job.processed_records;

  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value);
};

const recordStatusClass = (status: JobRecord["status"]): string => {
  if (status === "applied") {
    return "border-green-200 bg-green-50 text-green-800";
  }

  if (status === "invalid") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (status === "valid") {
    return "border-brand-blue/20 bg-brand-blue/10 text-brand-blue";
  }

  if (status === "skipped_duplicate") {
    return "border-border-soft bg-cream text-muted";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
};

function ImportJobHeader({
  badge,
  jobId,
  lang,
}: {
  readonly badge?: ReactNode;
  readonly jobId: string;
  readonly lang: Locale;
}): ReactNode {
  const copy = messagesFor(lang);

  return (
    <AdminPageHeader
      lang={lang}
      breadcrumbs={[
        { label: copy.adminWorkspace, to: "/admin", search: { lang } },
        { label: copy.adminImports, to: "/admin/imports", search: { lang } },
        { label: `${copy.adminImportsJob} ${jobId.slice(0, 8)}` },
      ]}
      title={`${copy.adminImportsJob} ${jobId}`}
      badge={badge}
    />
  );
}

function AdminImportDetailError({ reset }: { readonly reset: () => void }) {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const router = useRouter();
  const { jobId } = Route.useParams();

  const retry = (): void => {
    reset();
    void router.invalidate();
  };

  return (
    // The admin shell provides the page container; this view owns content only.
    <div>
      <ImportJobHeader jobId={jobId} lang={lang} />
      <p
        role="alert"
        className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-800"
      >
        {copy.adminLoadFailed}
      </p>
      <p className="mt-4">
        <button
          type="button"
          onClick={retry}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-blue-hover motion-safe:transition-colors"
        >
          {copy.commonRetry}
        </button>
      </p>
    </div>
  );
}

function AdminImportDetail() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const router = useRouter();
  const { jobId } = Route.useParams();
  const loaded: unknown = Route.useLoaderData();
  const parsed = jobDetailSchema.safeParse(loaded);
  const [detail, setDetail] = useState<JobDetail | null>(parsed.success ? parsed.data : null);
  const [page, setPage] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const terminal =
    detail === null || detail.job.status === "applied" || detail.job.status === "failed";

  const refreshNow = (): void => {
    adminImportJobDetailFn({ data: { jobId, recordLimit: RECORD_LIMIT } })
      .then((fresh) => {
        const raw: unknown = fresh;
        const next = jobDetailSchema.safeParse(raw);

        if (next.success) {
          setDetail(next.data);
          setRefreshFailed(false);
        } else {
          setRefreshFailed(true);
        }
      })
      .catch(() => {
        setRefreshFailed(true);
      });
  };

  useEffect(() => {
    if (terminal) {
      return undefined;
    }

    // Malformed poll payloads are ignored so a live "applying" job never
    // crashes the page; only network failures stop the timer.
    const timer = window.setInterval(() => {
      adminImportJobDetailFn({ data: { jobId, recordLimit: RECORD_LIMIT } })
        .then((fresh) => {
          const raw: unknown = fresh;
          const next = jobDetailSchema.safeParse(raw);

          if (next.success) {
            setDetail(next.data);
            setRefreshFailed(false);
          }
        })
        .catch(() => {
          setRefreshFailed(true);
          window.clearInterval(timer);
        });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [jobId, terminal]);

  if (detail === null) {
    return (
      // The admin shell provides the page container; this view owns content only.
      <div>
        <ImportJobHeader jobId={jobId} lang={lang} />
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-800"
        >
          {copy.adminLoadFailed}
        </p>
        <p className="mt-4">
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-blue-hover motion-safe:transition-colors"
          >
            {copy.commonRetry}
          </button>
        </p>
      </div>
    );
  }

  const applied = countByStatus(detail.records, "applied");
  const skipped = countByStatus(detail.records, "skipped_duplicate");
  const failed = countByStatus(detail.records, "invalid");
  const counted = applied + skipped + failed;
  const jobTotal = detail.job.total_records > 0 ? detail.job.total_records : detail.records.length;
  const reported = readProcessedRecords(loaded);
  const processed = Math.min(reported ?? counted, jobTotal);
  const total = detail.records.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = detail.records.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const failureCount = detail.records.filter(
    (record) => parseErrors(record.errors).length > 0,
  ).length;

  const downloadFailures = (): void => {
    downloadText(`import-${detail.job.id}-failures.csv`, buildFailureCsv(detail), "text/csv");
  };

  const showPrevious = (): void => {
    setPage(safePage - 1);
  };

  const showNext = (): void => {
    setPage(safePage + 1);
  };

  const applying = detail.job.status === "applying";

  return (
    // The admin shell provides the page container; this view owns content only.
    <div className="min-w-0">
      <ImportJobHeader
        jobId={detail.job.id}
        lang={lang}
        badge={<ImportStatusBadge status={detail.job.status} />}
      />

      {applying ? (
        <section
          aria-live="polite"
          aria-label={copy.adminImportApplying}
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm"
        >
          <p className="text-sm font-semibold text-amber-800">{copy.adminImportApplying}</p>
          <button
            type="button"
            onClick={refreshNow}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-amber-200 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100 motion-safe:transition-colors"
          >
            {copy.adminImportRefreshStatus}
          </button>
        </section>
      ) : null}

      <section
        aria-label={copy.adminImportJobDetails}
        className="mt-6 rounded-lg border border-border-soft bg-white p-4 shadow-sm sm:p-6"
      >
        <h2 className="font-display text-2xl tracking-wide">{copy.adminImportJobDetails}</h2>

        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminSource}
            </dt>
            <dd className="mt-1 text-sm break-words">{detail.job.source_name}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportsFormat}
            </dt>
            <dd className="mt-1 text-sm">{detail.job.format}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminStatus}
            </dt>
            <dd className="mt-1 text-sm">
              <ImportStatusBadge status={detail.job.status} />
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportTotalRecords}
            </dt>
            <dd className="mt-1 text-sm tabular-nums">{detail.job.total_records}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportValidCount}
            </dt>
            <dd className="mt-1 text-sm tabular-nums">{detail.job.valid_records}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportInvalidCount}
            </dt>
            <dd className="mt-1 text-sm tabular-nums">{detail.job.invalid_records}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportSourceUrl}
            </dt>
            <dd className="mt-1 text-sm break-words">{cellText(detail.job.source_url)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportSourceVersion}
            </dt>
            <dd className="mt-1 text-sm break-words">{cellText(detail.job.source_version)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminLicense}
            </dt>
            <dd className="mt-1 text-sm break-words">{cellText(detail.job.license)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportAttribution}
            </dt>
            <dd className="mt-1 text-sm break-words">{cellText(detail.job.attribution)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminImportEditorialNotes}
            </dt>
            <dd className="mt-1 text-sm break-words">{cellText(detail.job.editorial_notes)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminCreated}
            </dt>
            <dd className="mt-1 text-sm">{formatAdminDateTime(detail.job.created_at, lang)}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.adminCompleted}
            </dt>
            <dd className="mt-1 text-sm">
              {detail.job.completed_at === null
                ? cellText(detail.job.completed_at)
                : formatAdminDateTime(detail.job.completed_at, lang)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-label={copy.adminImportProgress}
        aria-live="polite"
        className="mt-6 rounded-lg border border-border-soft bg-white p-4 shadow-sm sm:p-6"
      >
        <h2 className="font-display text-2xl tracking-wide">{copy.adminImportProgress}</h2>

        <div className="mt-3">
          <ProgressBar label={copy.adminImportProgress} max={jobTotal} value={processed} />
        </div>
        <p className="mt-2 text-sm">
          {processed} of {jobTotal} records processed ({applied} applied, {skipped} skipped
          duplicates, {failed} failed).
        </p>

        {!terminal ? <p className="mt-2 text-sm text-muted">{copy.adminImportRefreshing}</p> : null}

        {refreshFailed ? (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            <span role="alert">{copy.adminLoadFailed}</span>
            <button
              type="button"
              onClick={refreshNow}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-red-200 bg-white px-4 text-sm font-semibold hover:bg-red-100 motion-safe:transition-colors"
            >
              {copy.commonRetry}
            </button>
          </p>
        ) : null}
      </section>

      <section
        aria-label={copy.adminImportRecordsTitle}
        className="mt-6 rounded-lg border border-border-soft bg-white p-4 shadow-sm sm:p-6"
      >
        <h2 className="font-display text-2xl tracking-wide">{copy.adminImportRecordsTitle}</h2>

        {failureCount > 0 ? (
          <p className="mt-3">
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-blue-hover motion-safe:transition-colors"
              onClick={downloadFailures}
            >
              {copy.adminImportDownloadFailures}
            </button>
          </p>
        ) : null}

        {total === 0 ? (
          <p className="mt-3 text-sm text-muted">{copy.adminNoResults}</p>
        ) : (
          <>
            <div className="mt-3 max-h-[36rem] min-w-0 overflow-auto rounded-lg border border-border-soft">
              <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
                <caption className="bg-cream/60 px-4 py-3 text-left text-xs font-medium text-muted">
                  Page {safePage + 1} of {totalPages} ({total} records)
                </caption>

                <thead>
                  <tr className="border-y border-border-soft">
                    <th scope="col" className="sticky top-0 w-40 bg-cream px-4 py-3 font-semibold">
                      {copy.adminImportExternalRef}
                    </th>
                    <th scope="col" className="sticky top-0 w-40 bg-cream px-4 py-3 font-semibold">
                      {copy.adminStatus}
                    </th>
                    <th scope="col" className="sticky top-0 w-72 bg-cream px-4 py-3 font-semibold">
                      {copy.adminImportErrorsCol}
                    </th>
                    <th scope="col" className="sticky top-0 w-32 bg-cream px-4 py-3 font-semibold">
                      {copy.adminImportDishCol}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 min-w-64 bg-cream px-4 py-3 font-semibold"
                    >
                      {copy.adminImportPreviewCol}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {visible.map((record) => {
                    const failures = parseErrors(record.errors);

                    return (
                      <tr
                        key={record.id}
                        className="border-b border-border-soft align-top last:border-0"
                      >
                        <td className="px-4 py-3 font-medium break-words">{record.external_ref}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${recordStatusClass(record.status)}`}
                          >
                            {record.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {failures.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5 text-red-800">
                              {failures.map((failure) => (
                                <li key={failure} className="break-words">
                                  {failure}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 break-words">{cellText(record.dish_id)}</td>
                        <td className="px-4 py-3">
                          <p className="break-words">{payloadSummary(record.payload)}</p>
                          <details className="mt-2 rounded-md border border-border-soft bg-cream/60 px-3 py-2">
                            <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold">
                              Raw payload
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto text-xs break-words whitespace-pre-wrap">
                              {record.payload}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <p className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border-soft bg-white px-5 text-sm font-bold hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                  disabled={safePage === 0}
                  onClick={showPrevious}
                >
                  {copy.adminImportPrevious}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border-soft bg-white px-5 text-sm font-bold hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                  disabled={safePage >= totalPages - 1}
                  onClick={showNext}
                >
                  {copy.adminImportNext}
                </button>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
