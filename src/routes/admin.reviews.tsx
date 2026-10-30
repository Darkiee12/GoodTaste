import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import {
  AdminEmptyState,
  AdminErrorState,
  AdminGhostButton,
  AdminPageHeading,
  AdminRouteError,
  AdminTable,
} from "@/components/admin/ui";
import { adminReviewQueueFn } from "@/modules/food-discovery/admin.functions";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const reviewsSearch = localeSearchSchema.extend({
  cursor: z.string().default("0"),
});

export const Route = createFileRoute("/admin/reviews")({
  validateSearch: reviewsSearch,
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin/reviews", lang: search.lang } });
    }

    const { allowed } = await authorizeFn({
      data: { checks: [{ resource: "moderation", actions: ["read"] }] },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async ({ deps }): Promise<ReadonlyArray<ReviewItem>> =>
    adminReviewQueueFn({ data: { limit: 20, cursor: deps.cursor } }),
  component: AdminReviews,
  errorComponent: AdminRouteError,
});

interface ReviewItem {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly displayName: string | null;
}

function AdminReviews() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const initial = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeading title={copy.adminReviewsHeading} />
      <ReviewRows key={lang} initial={initial} />
    </div>
  );
}

function ReviewRows({ initial }: { readonly initial: ReadonlyArray<ReviewItem> }) {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const [extra, setExtra] = useState<ReadonlyArray<ReviewItem>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rows = [...initial, ...extra];
  const lastId = rows.length > 0 ? (rows[rows.length - 1]?.id ?? "0") : "0";

  const loadMore = useMutation({
    mutationFn: () => adminReviewQueueFn({ data: { limit: 20, cursor: lastId } }),
    onSuccess: (page) => {
      setExtra((previous) => [...previous, ...page]);
      setLoadError(null);
    },
    onError: () => {
      setLoadError(copy.adminLoadFailed);
    },
  });

  const handleRetry = (): void => {
    loadMore.mutate();
  };

  return (
    <>
      <div aria-live="polite" className="flex flex-col gap-3">
        {loadError !== null ? (
          <AdminErrorState
            message={loadError}
            retryLabel={copy.commonRetry}
            onRetry={handleRetry}
            pending={loadMore.isPending}
          />
        ) : null}
        {rows.length === 0 ? (
          <AdminEmptyState message={copy.adminNoResults} />
        ) : (
          <AdminTable>
            <thead>
              <tr className="border-b border-border-soft bg-cream">
                <th scope="col" className="px-3 py-2 font-semibold">
                  {copy.adminDishName}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {copy.adminStatus}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  <span className="sr-only">{copy.adminOpenDish}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {entry.displayName ?? entry.slug}
                    {entry.displayName !== null ? (
                      <span className="block text-xs font-normal text-muted">{entry.slug}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{entry.status}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/admin/dishes/$dishId"
                      params={{ dishId: entry.id }}
                      search={{ lang }}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-blue underline"
                    >
                      {copy.adminOpenDish}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>

      {rows.length > 0 ? (
        <div>
          <AdminGhostButton
            type="button"
            disabled={loadMore.isPending}
            aria-busy={loadMore.isPending}
            onClick={handleRetry}
          >
            {copy.adminNextPage}
          </AdminGhostButton>
        </div>
      ) : null}
    </>
  );
}
