import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { adminReviewQueueFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const reviewsSearch = localeSearchSchema.extend({
  cursor: z.string().default("0"),
});

export const Route = createFileRoute("/admin/reviews")({
  validateSearch: reviewsSearch,
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin/reviews", lang: search.lang } });
    }

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: async ({ deps }): Promise<ReadonlyArray<ReviewItem>> =>
    adminReviewQueueFn({ data: { limit: 20, cursor: deps.cursor } }),
  component: AdminReviews,
});

interface ReviewItem {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
}

function AdminReviews() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const initial = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-4xl tracking-wide">{copy.adminReviewsHeading}</h1>
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

  return (
    <>
      <div aria-live="polite">
        {loadError !== null ? (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
          >
            {loadError}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-border-soft bg-white p-4 text-sm">
            {copy.adminNoResults}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border-soft bg-white">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-cream">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {copy.adminSlug}
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
                    <td className="px-3 py-2 font-medium">{entry.slug}</td>
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
            </table>
          </div>
        )}
      </div>

      {rows.length > 0 ? (
        <div>
          <button
            type="button"
            disabled={loadMore.isPending}
            aria-busy={loadMore.isPending}
            onClick={() => {
              loadMore.mutate();
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border-soft bg-white px-4 py-2 text-sm font-semibold hover:bg-cream disabled:opacity-50"
          >
            {copy.adminNextPage}
          </button>
        </div>
      ) : null}
    </>
  );
}
