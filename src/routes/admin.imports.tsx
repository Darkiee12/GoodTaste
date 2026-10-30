import { useMutation } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  getRouteApi,
  redirect,
  useChildMatches,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { AdminSelectField } from "@/components/admin/select";
import { ImportStatusBadge } from "@/components/admin/ui";
import { adminImportJobsFn } from "@/modules/food-discovery/admin.functions";
import { importJobStatusSchema } from "@/modules/food-discovery/admin.schema";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatAdminDate } from "@/shared/format";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const PAGE_SIZE = 20;

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
  status: importJobStatusSchema,
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
  "applying",
  "applied",
  "failed",
];

export const Route = createFileRoute("/admin/imports")({
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
  loader: () => adminImportJobsFn({ data: { limit: PAGE_SIZE, offset: 0 } }),
  component: AdminImports,
});

function AdminImports() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const childMatches = useChildMatches();
  const initialJobs = importJobsSchema.parse(Route.useLoaderData());
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [jobs, setJobs] = useState<ReadonlyArray<ImportJob>>(initialJobs);
  const [exhausted, setExhausted] = useState(initialJobs.length < PAGE_SIZE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const query = searchText.trim().toLowerCase();

  const loadMore = useMutation({
    mutationFn: (offset: number) => adminImportJobsFn({ data: { limit: PAGE_SIZE, offset } }),
    onSuccess: (page) => {
      const fresh = importJobsSchema.parse(page);
      setJobs((previous) => {
        const seen = new Set(previous.map((job) => job.id));

        return [...previous, ...fresh.filter((job) => !seen.has(job.id))];
      });
      setLoadError(null);

      if (page.length < PAGE_SIZE) {
        setExhausted(true);
      }
    },
    onError: () => {
      setLoadError(copy.adminLoadFailed);
    },
  });

  const selectStatusFilter = (value: string): void => {
    const next = STATUS_FILTERS.find((entry) => entry === value);

    if (next !== undefined) {
      setStatusFilter(next);
    }
  };

  const clearFilters = (): void => {
    setStatusFilter("all");
    setSearchText("");
  };

  // Status and source filters run client-side over the loaded pages, so
  // changing them needs no refetch — only Load More appends (deduplicated
  // by job id), which keeps the list stable while paging. The caption and
  // counts below are honest about that scope: "N of M loaded".
  const filtered = jobs.filter((job) => {
    if (statusFilter !== "all" && job.status !== statusFilter) {
      return false;
    }

    if (query !== "" && !job.source_name.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });

  const filtersActive = statusFilter !== "all" || query !== "";

  const countSummary =
    lang === "vi"
      ? `${filtered.length} trên ${jobs.length} tác vụ đã tải`
      : `${filtered.length} of ${jobs.length} loaded import jobs`;

  const hasHistory = jobs.length > 0;

  let historyBody: ReactNode = null;

  if (!hasHistory) {
    historyBody = (
      <div className="mt-4 rounded-lg border border-border-soft bg-white p-6 shadow-sm">
        <p className="text-sm text-muted">{copy.adminImportsEmpty}</p>
        <p className="mt-4">
          <Link
            to="/admin/imports/new"
            search={{ lang }}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-blue-hover motion-safe:transition-colors"
          >
            {copy.adminImportsNew}
          </Link>
        </p>
      </div>
    );
  }

  if (hasHistory && filtered.length === 0) {
    historyBody = (
      <div className="mt-4 rounded-lg border border-border-soft bg-white p-6 shadow-sm">
        <p className="text-sm text-muted">{copy.adminImportsNoMatch}</p>
      </div>
    );
  }

  if (hasHistory && filtered.length > 0) {
    historyBody = (
      <>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border-soft bg-white shadow-sm">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <caption className="px-4 py-3 text-left text-xs font-medium text-muted">
              {countSummary}
            </caption>
            <thead>
              <tr className="border-y border-border-soft bg-cream/60">
                <th scope="col" className="w-24 whitespace-nowrap px-4 py-3 font-semibold">
                  {copy.adminImportsJob}
                </th>
                <th scope="col" className="w-56 min-w-40 px-4 py-3 font-semibold">
                  {copy.adminSource}
                </th>
                <th scope="col" className="w-24 px-4 py-3 font-semibold">
                  {copy.adminImportsFormat}
                </th>
                <th scope="col" className="w-32 px-4 py-3 font-semibold">
                  {copy.adminStatus}
                </th>
                <th scope="col" className="w-20 px-4 py-3 text-right font-semibold">
                  {copy.adminImportsTotal}
                </th>
                <th scope="col" className="w-20 px-4 py-3 text-right font-semibold">
                  {copy.adminImportsValid}
                </th>
                <th scope="col" className="w-20 px-4 py-3 text-right font-semibold">
                  {copy.adminImportsInvalid}
                </th>
                <th scope="col" className="w-32 whitespace-nowrap px-4 py-3 font-semibold">
                  {copy.adminCreated}
                </th>
                <th scope="col" className="w-32 whitespace-nowrap px-4 py-3 font-semibold">
                  {copy.adminCompleted}
                </th>
                <th scope="col" className="w-36 px-4 py-3 font-semibold">
                  {copy.adminActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id} className="border-b border-border-soft last:border-0">
                  <td className="max-w-36 truncate px-4 py-3 font-medium">
                    <Link
                      to="/admin/imports/$jobId"
                      params={{ jobId: job.id }}
                      search={{ lang }}
                      className="inline-flex min-h-11 items-center text-brand-blue-hover underline underline-offset-4"
                    >
                      {job.id}
                    </Link>
                  </td>
                  <td className="max-w-56 truncate px-4 py-3" title={job.source_name}>
                    {job.source_name}
                  </td>
                  <td className="px-4 py-3 text-muted">{job.format}</td>
                  <td className="px-4 py-3">
                    <ImportStatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{job.total_records}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{job.valid_records}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{job.invalid_records}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {formatAdminDate(job.created_at, lang)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {job.completed_at === null ? "—" : formatAdminDate(job.completed_at, lang)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/imports/$jobId"
                      params={{ jobId: job.id }}
                      search={{ lang }}
                      className="inline-flex min-h-11 items-center text-brand-blue-hover underline underline-offset-4"
                    >
                      {copy.adminImportViewJob}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!exhausted ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={loadMore.isPending}
              aria-busy={loadMore.isPending}
              onClick={() => {
                loadMore.mutate(jobs.length);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border-soft bg-white px-4 py-2 text-sm font-semibold hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {copy.adminNextPage}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    // The admin shell already provides the max-width container and page
    // rhythm; this page owns only its content so headings never double-nest.
    <div>
      {childMatches.length > 0 ? <Outlet /> : null}

      {childMatches.length === 0 ? (
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-4xl tracking-wide">{copy.adminImportsTitle}</h1>
              <p className="mt-2 max-w-[60ch] text-muted">{copy.adminImportsIntro}</p>
            </div>
            <Link
              to="/admin/imports/new"
              search={{ lang }}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-blue-hover motion-safe:transition-colors"
            >
              {copy.adminImportsNew}
            </Link>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
            className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-border-soft bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
          >
            <AdminSelectField
              id="imports-status-filter"
              label={copy.adminImportsFilterStatus}
              value={statusFilter}
              onValueChange={selectStatusFilter}
              options={STATUS_FILTERS.map((value) => ({
                label: value === "all" ? copy.adminImportsAllStatuses : value,
                value,
              }))}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="imports-source-search" className="text-sm font-semibold">
                {copy.adminImportsSearchSource}
              </label>
              <input
                id="imports-source-search"
                type="search"
                value={searchText}
                placeholder={copy.adminImportsSearchPlaceholder}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
                className="min-h-11 w-full rounded-lg border border-border-soft bg-white px-3 text-sm text-ink outline-none focus-visible:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40 motion-safe:transition-colors"
              />
            </div>
            <button
              type="button"
              disabled={!filtersActive}
              tabIndex={filtersActive ? undefined : -1}
              onClick={clearFilters}
              className="inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-soft bg-white px-4 text-sm font-semibold whitespace-nowrap hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors md:w-auto md:min-w-32"
            >
              {copy.adminImportsClearFilters}
            </button>
          </form>

          <p aria-live="polite" className="sr-only">
            {countSummary}
          </p>

          <div aria-live="polite">
            {loadError !== null ? (
              <p
                role="alert"
                className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
              >
                <span>{loadError}</span>
                <button
                  type="button"
                  disabled={loadMore.isPending}
                  onClick={() => {
                    loadMore.mutate(jobs.length);
                  }}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-red-200 bg-white px-4 text-sm font-semibold hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                >
                  {copy.commonRetry}
                </button>
              </p>
            ) : null}
          </div>

          {historyBody}
        </div>
      ) : null}
    </div>
  );
}
