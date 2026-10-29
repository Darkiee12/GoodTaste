import { Link, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";

import {
  AdminEmptyState,
  AdminPageHeading,
  AdminRouteError,
  AdminSection,
  AdminTable,
  adminPrimaryButtonClass,
} from "@/components/admin/ui";
import { adminDashboardStatsFn } from "@/modules/food-discovery/admin.functions";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatAdminDate } from "@/shared/format";
import { messagesFor, type Locale, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin", lang: search.lang } });
    }

    const { allowed } = await authorizeFn({
      data: { checks: [{ resource: "food", actions: ["read"] }] },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async (): Promise<AdminDashboard> => adminDashboardStatsFn(),
  component: AdminOverview,
  errorComponent: AdminRouteError,
});

interface DishStatusCounts {
  readonly published: number;
  readonly review: number;
  readonly draft: number;
  readonly archived: number;
}

interface ImportStatusCount {
  readonly status: string;
  readonly total: number;
}

interface RecentJob {
  readonly id: string;
  readonly source_name: string;
  readonly status: string;
  readonly total_records: number;
  readonly valid_records: number;
  readonly invalid_records: number;
  readonly dry_run: boolean;
  readonly created_at: DisplayTimestamp;
}

interface RecentDish {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly display_name: string | null;
  readonly updated_at: DisplayTimestamp;
}

interface AdminDashboard {
  readonly dishCounts: DishStatusCounts;
  readonly missingIngredients: number;
  readonly importByStatus: ReadonlyArray<ImportStatusCount>;
  readonly recentDishes: ReadonlyArray<RecentDish>;
  readonly recentJobs: ReadonlyArray<RecentJob>;
}

const statusLabel = (status: string, copy: Messages): string => {
  if (status === "published") {
    return copy.adminPublished;
  }

  if (status === "review") {
    return copy.adminInReview;
  }

  if (status === "draft") {
    return copy.adminDraft;
  }

  if (status === "archived") {
    return copy.adminArchived;
  }

  return status;
};

type DisplayTimestamp = Date | string;

const formatDate = (value: DisplayTimestamp, lang: Locale): string => formatAdminDate(value, lang);

function AdminOverview() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const stats = Route.useLoaderData();

  const failedJobs = stats.importByStatus
    .filter((entry) => entry.status === "failed")
    .reduce((total, entry) => total + entry.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeading
        title={copy.adminDashboard}
        action={
          <a href={`/admin/imports?lang=${lang}`} className={adminPrimaryButtonClass}>
            {copy.adminImportDishes}
          </a>
        }
      />

      <AdminSection title={copy.adminOverviewHeading}>
        <ul className="flex flex-col gap-2">
          <li className="border-food-orange flex flex-wrap items-center justify-between gap-2 border-l-4 rounded-r-lg bg-cream px-3 py-2">
            <span className="text-sm font-semibold">
              {failedJobs} · {copy.adminFailedJobs}
            </span>
          </li>
          <li className="border-food-orange flex flex-wrap items-center justify-between gap-2 border-l-4 rounded-r-lg bg-cream px-3 py-2">
            <span className="text-sm font-semibold">
              {stats.dishCounts.review} · {copy.adminPendingReview}
            </span>
            <Link
              to="/admin/reviews"
              search={{ lang }}
              className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-blue underline"
            >
              {copy.adminViewAll}
            </Link>
          </li>
          <li className="border-food-orange flex flex-wrap items-center justify-between gap-2 border-l-4 rounded-r-lg bg-cream px-3 py-2">
            <span className="text-sm font-semibold">
              {stats.missingIngredients} · {copy.adminMissingIngredients}
            </span>
            <Link
              to="/admin/dishes"
              search={{ lang, status: "review", cursor: "0" }}
              className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-blue underline"
            >
              {copy.adminViewAll}
            </Link>
          </li>
        </ul>
      </AdminSection>

      <AdminSection title={copy.adminHealth}>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-cream px-3 py-2">
            <dt className="text-xs font-semibold tracking-wide uppercase">{copy.adminPublished}</dt>
            <dd className="text-2xl font-bold">{stats.dishCounts.published}</dd>
          </div>
          <div className="rounded-lg bg-cream px-3 py-2">
            <dt className="text-xs font-semibold tracking-wide uppercase">{copy.adminInReview}</dt>
            <dd className="text-2xl font-bold">{stats.dishCounts.review}</dd>
          </div>
          <div className="rounded-lg bg-cream px-3 py-2">
            <dt className="text-xs font-semibold tracking-wide uppercase">{copy.adminDraft}</dt>
            <dd className="text-2xl font-bold">{stats.dishCounts.draft}</dd>
          </div>
          <div className="rounded-lg bg-cream px-3 py-2">
            <dt className="text-xs font-semibold tracking-wide uppercase">{copy.adminArchived}</dt>
            <dd className="text-2xl font-bold">{stats.dishCounts.archived}</dd>
          </div>
        </dl>
      </AdminSection>

      <AdminSection title={copy.adminRecentImports}>
        {stats.recentJobs.length === 0 ? (
          <AdminEmptyState message={copy.adminNoResults} />
        ) : (
          <AdminTable minWidthClass="min-w-[36rem]">
            <thead>
              <tr className="border-b border-border-soft bg-cream">
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminSource}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminStatus}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminRecords}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminCreated}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.recentJobs.map((job) => (
                <tr key={job.id} className="border-b border-border-soft last:border-0">
                  <td className="px-2 py-2 font-medium">
                    {job.source_name}
                    {job.dry_run ? <span> · {copy.adminDryRun}</span> : null}
                  </td>
                  <td className="px-2 py-2">{job.status}</td>
                  <td className="px-2 py-2">
                    {job.total_records} {copy.adminRecords} · {job.valid_records}{" "}
                    {copy.adminValidRecords} · {job.invalid_records} {copy.adminInvalidRecords}
                  </td>
                  <td className="px-2 py-2">{formatDate(job.created_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminSection>

      <AdminSection title={copy.adminRecentDishes}>
        {stats.recentDishes.length === 0 ? (
          <AdminEmptyState message={copy.adminNoResults} />
        ) : (
          <AdminTable>
            <thead>
              <tr className="border-b border-border-soft bg-cream">
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminDishName}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminStatus}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {copy.adminUpdated}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.recentDishes.map((dish) => (
                <tr key={dish.id} className="border-b border-border-soft last:border-0">
                  <td className="px-2 py-2">
                    <Link
                      to="/admin/dishes/$dishId"
                      params={{ dishId: dish.id }}
                      search={{ lang }}
                      className="inline-flex min-h-11 items-center font-medium text-brand-blue underline"
                    >
                      {dish.display_name ?? dish.slug}
                    </Link>
                    {dish.display_name !== null ? (
                      <span className="block text-xs text-muted">{dish.slug}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{statusLabel(dish.status, copy)}</td>
                  <td className="px-2 py-2">{formatDate(dish.updated_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminSection>
    </div>
  );
}
