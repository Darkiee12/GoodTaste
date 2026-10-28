import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { adminDishesListFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { localeSearchSchema, messagesFor, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const dishesSearch = localeSearchSchema.extend({
  status: z.enum(["draft", "review", "published", "archived"]).default("review"),
  cursor: z.string().default("0"),
});

export const Route = createFileRoute("/admin/dishes")({
  validateSearch: dishesSearch,
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin/dishes", lang: search.lang } });
    }

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loaderDeps: ({ search }) => ({ status: search.status, cursor: search.cursor }),
  loader: async ({ deps }) =>
    dishListSchema.parse(
      await adminDishesListFn({ data: { status: deps.status, limit: 20, cursor: deps.cursor } }),
    ),
  component: AdminDishes,
});

const dishListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.string(),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
});

const dishListSchema = z.array(dishListItemSchema);

type DishListItem = z.infer<typeof dishListItemSchema>;

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

const formatDate = (value: DisplayTimestamp): string => new Date(value).toLocaleDateString();

const STATUSES = ["draft", "review", "published", "archived"] as const;

function AdminDishes() {
  const { lang } = rootRoute.useSearch();
  const { status } = Route.useSearch();
  const copy = messagesFor(lang);
  const initial = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-4xl tracking-wide">{copy.adminDishesHeading}</h1>

      <fieldset className="rounded-2xl border border-border-soft bg-white p-4">
        <legend className="px-1 text-sm font-bold">{copy.adminFilterByStatus}</legend>
        <ul className="flex flex-row flex-wrap gap-2">
          {STATUSES.map((entry) => (
            <li key={entry}>
              <Link
                to="/admin/dishes"
                search={{ lang, status: entry, cursor: "0" }}
                aria-current={entry === status ? "true" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border border-border-soft px-4 py-2 text-sm font-semibold aria-current:border-food-orange aria-current:bg-cream aria-current:text-food-orange-dark"
              >
                {statusLabel(entry, copy)}
              </Link>
            </li>
          ))}
        </ul>
      </fieldset>

      <DishRows key={`${lang}:${status}`} initial={initial} />
    </div>
  );
}

function DishRows({ initial }: { readonly initial: ReadonlyArray<DishListItem> }) {
  const { lang } = rootRoute.useSearch();
  const { status } = Route.useSearch();
  const copy = messagesFor(lang);
  const [extra, setExtra] = useState<ReadonlyArray<DishListItem>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rows = [...initial, ...extra];
  const lastId = rows.length > 0 ? (rows[rows.length - 1]?.id ?? "0") : "0";

  const loadMore = useMutation({
    mutationFn: async () =>
      dishListSchema.parse(
        await adminDishesListFn({ data: { status, limit: 20, cursor: lastId } }),
      ),
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
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-cream">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {copy.adminSlug}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {copy.adminStatus}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {copy.adminUpdated}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((dish) => (
                  <tr key={dish.id} className="border-b border-border-soft last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        to="/admin/dishes/$dishId"
                        params={{ dishId: dish.id }}
                        search={{ lang }}
                        className="inline-flex min-h-11 items-center font-medium text-brand-blue underline"
                      >
                        {dish.slug}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{statusLabel(dish.status, copy)}</td>
                    <td className="px-3 py-2">{formatDate(dish.updated_at)}</td>
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
