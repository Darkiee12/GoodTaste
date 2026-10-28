import { Link, Outlet, createFileRoute, getRouteApi, redirect, useChildMatches } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { adminImportJobsFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";

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

const STATUS_FILTERS: ReadonlyArray<{ value: JobStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "staged", label: "Staged" },
  { value: "validated", label: "Validated" },
  { value: "applied", label: "Applied" },
  { value: "failed", label: "Failed" },
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
    const next = STATUS_FILTERS.find((option) => option.value === value);

    if (next !== undefined) {
      setStatusFilter(next.value);
    }
  };

  return (
    <div className="bg-cream min-h-screen text-ink">
      {childMatches.length > 0 ? <Outlet /> : null}

      {childMatches.length === 0 ? (
        <div>
          <h1 className="font-display text-4xl tracking-wide">Dataset imports</h1>

      <p>
        Review past imports. Applying an import sends records to editorial review, never to the
        public catalog.
      </p>

      <p>
        <Link
          to="/admin/imports/new"
          search={{ lang }}
          className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 font-bold text-white"
        >
          New import
        </Link>
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          Filter by status
          <select
            value={statusFilter}
            onChange={(event) => {
              selectStatusFilter(event.target.value);
            }}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Search by source name
          <input
            type="search"
            value={searchText}
            placeholder="e.g. partner dataset"
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
              <th scope="col">Job</th>
              <th scope="col">Source</th>
              <th scope="col">Format</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Valid</th>
              <th scope="col">Invalid</th>
              <th scope="col">Created</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>

          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link to="/admin/imports/$jobId" params={{ jobId: job.id }} search={{ lang }}>
                    Job {job.id}
                  </Link>
                </td>
                <td>{job.source_name}</td>
                <td>{job.format}</td>
                <td>{job.status}</td>
                <td>{job.total_records}</td>
                <td>{job.valid_records}</td>
                <td>{job.invalid_records}</td>
                <td>{job.created_at}</td>
                <td>{cellText(job.completed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {jobs.length === 0 ? <p>No import jobs match the current filters.</p> : null}
    </div>
  );
}
