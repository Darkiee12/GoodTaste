import {
  Link,
  Outlet,
  createFileRoute,
  getRouteApi,
  redirect,
  useChildMatches,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { adminImportJobsFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatAdminDate } from "@/shared/format";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/imports")({
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
  loader: async () => adminImportJobsFn({ data: { limit: 50 } }),
  component: AdminImports,
});

const importJobSchema = z.object({
  completed_at: z.string().nullable(),
  created_at: z.string(),
  dry_run: z.boolean(),
  format: z.union([z.literal("csv"), z.literal("json")]),
  id: z.string(),
  invalid_records: z.number(),
  license: z.string().nullable(),
  source_name: z.string(),
  source_url: z.string().nullable(),
  status: z.union([
    z.literal("applied"),
    z.literal("failed"),
    z.literal("staged"),
    z.literal("validated"),
  ]),
  total_records: z.number(),
  valid_records: z.number(),
});

const importJobsSchema = z.array(importJobSchema);

type ImportJob = z.infer<typeof importJobSchema>;

type JobStatusFilter = "all" | ImportJob["status"];

const STATUS_FILTERS: ReadonlyArray<JobStatusFilter> = [
  "all",
  "staged",
  "validated",
  "applied",
  "failed",
];

type CellValue = string | number | boolean | null;

const cellText = (value: CellValue): string => {
  if (value === null) {
    return "—";
  }

  return String(value);
};

function AdminImports() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const childMatches = useChildMatches();
  const loaded: unknown = Route.useLoaderData();
  const initial = importJobsSchema.parse(loaded);
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const query = searchText.trim().toLowerCase();

  const jobs = initial.filter((job) => {
    if (statusFilter !== "all" && job.status !== statusFilter) {
      return false;
    }

    if (query !== "" && !job.source_name.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });

  const selectStatusFilter = (value: string): void => {
    const next = STATUS_FILTERS.find((entry) => entry === value);

    if (next !== undefined) {
      setStatusFilter(next);
    }
  };

  return (
    <div className="bg-cream min-h-screen text-ink">
      {childMatches.length > 0 ? <Outlet /> : null}

      {childMatches.length === 0 ? (
        <div>
          <h1 className="font-display text-4xl tracking-wide">{copy.adminImportsTitle}</h1>

          <p>{copy.adminImportsIntro}</p>

          <p>
            <Link
              to="/admin/imports/new"
              search={{ lang }}
              className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
            >
              {copy.adminImportsNew}
            </Link>
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label>
              {copy.adminImportsFilterStatus}
              <select
                value={statusFilter}
                onChange={(event) => {
                  selectStatusFilter(event.target.value);
                }}
              >
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value === "all" ? copy.adminImportsAllStatuses : value}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {copy.adminImportsSearchSource}
              <input
                type="search"
                value={searchText}
                placeholder={copy.adminImportsSearchPlaceholder}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
              />
            </label>
          </form>

          <div className="overflow-x-auto">
            <table>
              <caption>
                {jobs.length} of {initial.length} import jobs
              </caption>

              <thead>
                <tr>
                  <th scope="col">{copy.adminImportsJob}</th>
                  <th scope="col">{copy.adminSource}</th>
                  <th scope="col">{copy.adminImportsFormat}</th>
                  <th scope="col">{copy.adminStatus}</th>
                  <th scope="col">{copy.adminImportsTotal}</th>
                  <th scope="col">{copy.adminImportsValid}</th>
                  <th scope="col">{copy.adminImportsInvalid}</th>
                  <th scope="col">{copy.adminCreated}</th>
                  <th scope="col">{copy.adminCompleted}</th>
                </tr>
              </thead>

              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link to="/admin/imports/$jobId" params={{ jobId: job.id }} search={{ lang }}>
                        {copy.adminImportsJob} {job.id}
                      </Link>
                    </td>
                    <td>{job.source_name}</td>
                    <td>{job.format}</td>
                    <td>{job.status}</td>
                    <td>{job.total_records}</td>
                    <td>{job.valid_records}</td>
                    <td>{job.invalid_records}</td>
                    <td>{formatAdminDate(job.created_at, lang)}</td>
                    <td>
                      {job.completed_at === null
                        ? cellText(job.completed_at)
                        : formatAdminDate(job.completed_at, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {jobs.length === 0 ? <p>{copy.adminImportsNoMatch}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
