import { createFileRoute, getRouteApi, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { adminImportJobDetailFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";

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

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async ({ params }) =>
    adminImportJobDetailFn({ data: { jobId: params.jobId, recordLimit: RECORD_LIMIT } }),
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
  status: z.union([
    z.literal("applied"),
    z.literal("failed"),
    z.literal("staged"),
    z.literal("validated"),
  ]),
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

function AdminImportDetail() {
  const { lang } = rootRoute.useSearch();
  const { jobId } = Route.useParams();
  const loaded: unknown = Route.useLoaderData();
  const initial = jobDetailSchema.parse(loaded);
  const [detail, setDetail] = useState<JobDetail>(initial);
  const [page, setPage] = useState(0);
  const terminal = detail.job.status === "applied" || detail.job.status === "failed";

  useEffect(() => {
    if (terminal) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      adminImportJobDetailFn({ data: { jobId, recordLimit: RECORD_LIMIT } })
        .then((fresh) => {
          const raw: unknown = fresh;

          setDetail(jobDetailSchema.parse(raw));
        })
        .catch(() => {
          window.clearInterval(timer);
        });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [jobId, terminal]);

  const applied = countByStatus(detail.records, "applied");
  const skipped = countByStatus(detail.records, "skipped_duplicate");
  const failed = countByStatus(detail.records, "invalid");
  const processed = applied + skipped + failed;
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

  return (
    <div className="bg-cream min-h-screen text-ink">
      <p>
        <Link to="/admin/imports" search={{ lang }}>
          Back to imports
        </Link>
      </p>

      <h1 className="font-display text-4xl tracking-wide">Import job {detail.job.id}</h1>

      <section aria-label="Job metadata">
        <h2 className="font-display text-2xl tracking-wide">Job details</h2>

        <dl>
          <div>
            <dt>Source</dt>
            <dd>{detail.job.source_name}</dd>
          </div>

          <div>
            <dt>Format</dt>
            <dd>{detail.job.format}</dd>
          </div>

          <div>
            <dt>Status</dt>
            <dd>{detail.job.status}</dd>
          </div>

          <div>
            <dt>Total records</dt>
            <dd>{detail.job.total_records}</dd>
          </div>

          <div>
            <dt>Valid records</dt>
            <dd>{detail.job.valid_records}</dd>
          </div>

          <div>
            <dt>Invalid records</dt>
            <dd>{detail.job.invalid_records}</dd>
          </div>

          <div>
            <dt>Source URL</dt>
            <dd>{cellText(detail.job.source_url)}</dd>
          </div>

          <div>
            <dt>Source version</dt>
            <dd>{cellText(detail.job.source_version)}</dd>
          </div>

          <div>
            <dt>License</dt>
            <dd>{cellText(detail.job.license)}</dd>
          </div>

          <div>
            <dt>Attribution</dt>
            <dd>{cellText(detail.job.attribution)}</dd>
          </div>

          <div>
            <dt>Editorial notes</dt>
            <dd>{cellText(detail.job.editorial_notes)}</dd>
          </div>

          <div>
            <dt>Created</dt>
            <dd>{detail.job.created_at}</dd>
          </div>

          <div>
            <dt>Completed</dt>
            <dd>{cellText(detail.job.completed_at)}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Progress" aria-live="polite">
        <h2 className="font-display text-2xl tracking-wide">Progress</h2>

        <p>
          {processed} of {total} records processed ({applied} applied, {skipped} skipped duplicates,{" "}
          {failed} failed).
        </p>

        {!terminal ? <p>Refreshing every 5 seconds while the job is running.</p> : null}
      </section>

      <section aria-label="Records">
        <h2 className="font-display text-2xl tracking-wide">Records</h2>

        {failureCount > 0 ? (
          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
              onClick={downloadFailures}
            >
              Download failures CSV
            </button>
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table>
            <caption>
              Page {safePage + 1} of {totalPages} ({total} records)
            </caption>

            <thead>
              <tr>
                <th scope="col">External ref</th>
                <th scope="col">Status</th>
                <th scope="col">Errors</th>
                <th scope="col">Dish</th>
                <th scope="col">Preview</th>
              </tr>
            </thead>

            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>{record.external_ref}</td>
                  <td>{record.status}</td>
                  <td>{parseErrors(record.errors).join(" | ") || "—"}</td>
                  <td>{cellText(record.dish_id)}</td>
                  <td>{payloadSummary(record.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              disabled={safePage === 0}
              onClick={showPrevious}
            >
              Previous
            </button>{" "}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full px-5 font-bold"
              disabled={safePage >= totalPages - 1}
              onClick={showNext}
            >
              Next
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
