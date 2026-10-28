import { Link, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";

import { adminDishDetailFn, adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import { getSessionFn } from "@/modules/user/session.functions";
import { localeSearchSchema, messagesFor, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/dishes/$dishId")({
  validateSearch: localeSearchSchema,
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/admin/dishes", lang: search.lang },
      });
    }

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loaderDeps: ({ search }) => ({ locale: search.lang }),
  loader: async ({ params, deps }): Promise<DishDetailData> =>
    adminDishDetailFn({ data: { dishId: params.dishId, locale: deps.locale } }),
  component: AdminDishDetail,
});

interface DishNote {
  readonly id: string;
  readonly author: string;
  readonly noteKind: string;
  readonly note: string;
  readonly createdAt: DisplayTimestamp;
}

interface DishRevision {
  readonly id: string;
  readonly actor: string;
  readonly operation: string;
  readonly summary: string;
  readonly createdAt: DisplayTimestamp;
}

interface DishDetailData {
  readonly dish: DishProfile;
  readonly notes: ReadonlyArray<DishNote>;
  readonly revisions: ReadonlyArray<DishRevision>;
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

const formatDate = (value: DisplayTimestamp): string => new Date(value).toLocaleDateString();

function AdminDishDetail() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const detail = Route.useLoaderData();
  const { dish, notes, revisions } = detail;
  const title = dish.englishName ?? dish.name ?? dish.slug;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/admin/dishes"
        search={{ lang, status: "review", cursor: "0" }}
        className="inline-flex min-h-11 w-fit items-center rounded-lg px-2 py-2 text-sm font-semibold text-brand-blue underline"
      >
        ← {copy.adminBackToDishes}
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-4xl tracking-wide">{title}</h1>
        <p className="rounded-full bg-cream px-3 py-1 text-sm font-bold text-food-orange-dark">
          {copy.adminStatus}: {statusLabel(dish.status, copy)}
        </p>
      </div>

      <section
        aria-labelledby="admin-dish-names"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-names" className="text-lg font-bold">
          {copy.adminNames}
        </h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {dish.nativeNames.map((entry) => (
            <li key={`${entry.languageTag}:${entry.name}`}>
              <span className="font-semibold">{entry.languageTag}</span>: {entry.name}
            </li>
          ))}
          {dish.nativeNames.length === 0 ? <li>{copy.adminNoResults}</li> : null}
        </ul>
        {dish.description !== null ? (
          <>
            <h3 className="mt-3 text-sm font-bold">{copy.adminDescriptions}</h3>
            <p className="mt-1 text-sm">{dish.description}</p>
          </>
        ) : null}
      </section>

      <section
        aria-labelledby="admin-dish-ingredients"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-ingredients" className="text-lg font-bold">
          {copy.adminIngredients}
        </h2>
        {dish.ingredients.length === 0 ? (
          <p className="mt-2 text-sm">{copy.adminNoResults}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {dish.ingredients.map((entry) => (
              <li key={entry.id}>
                {entry.name ?? entry.id} <span className="text-muted">· {entry.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="admin-dish-places"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-places" className="text-lg font-bold">
          {copy.adminPlaces}
        </h2>
        {dish.places.length === 0 ? (
          <p className="mt-2 text-sm">{copy.adminNoResults}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {dish.places.map((entry) => (
              <li key={entry.id}>
                {entry.name ?? entry.id}{" "}
                <span className="text-muted">
                  · {entry.association}
                  {entry.isDisputed ? " · disputed" : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="admin-dish-taxonomy"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-taxonomy" className="text-lg font-bold">
          {copy.adminCuisines} · {copy.adminCategories}
        </h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {dish.cuisines.map((entry) => (
            <li key={entry.id}>
              {copy.adminCuisines}: {entry.name ?? entry.slug}
            </li>
          ))}
          {dish.categories.map((entry) => (
            <li key={entry.id}>
              {copy.adminCategories}: {entry.name ?? entry.slug}
            </li>
          ))}
          {dish.cuisines.length === 0 && dish.categories.length === 0 ? (
            <li>{copy.adminNoResults}</li>
          ) : null}
        </ul>
      </section>

      <section
        aria-labelledby="admin-dish-provenance"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-provenance" className="text-lg font-bold">
          {copy.adminProvenance}
        </h2>
        {dish.sources.length === 0 ? (
          <p className="mt-2 text-sm">{copy.adminNoResults}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-soft">
                  <th scope="col" className="px-2 py-2 font-semibold">
                    {copy.adminSource}
                  </th>
                  <th scope="col" className="px-2 py-2 font-semibold">
                    {copy.adminLicense}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dish.sources.map((entry) => (
                  <tr key={entry.recordId} className="border-b border-border-soft last:border-0">
                    <td className="px-2 py-2">
                      {entry.provider} · {entry.externalId}
                      {entry.attribution !== null ? <span> · {entry.attribution}</span> : null}
                    </td>
                    <td className="px-2 py-2">{entry.license ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        aria-labelledby="admin-dish-notes"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-notes" className="text-lg font-bold">
          {copy.adminNotes}
        </h2>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm">{copy.adminNoResults}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {notes.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-cream px-3 py-2 text-sm">
                <p className="font-semibold">
                  {entry.author} · {entry.noteKind} · {formatDate(entry.createdAt)}
                </p>
                <p className="mt-1">{entry.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="admin-dish-revisions"
        className="rounded-2xl border border-border-soft bg-white p-4"
      >
        <h2 id="admin-dish-revisions" className="text-lg font-bold">
          {copy.adminRevisions}
        </h2>
        {revisions.length === 0 ? (
          <p className="mt-2 text-sm">{copy.adminNoResults}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {revisions.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-cream px-3 py-2 text-sm">
                <p className="font-semibold">
                  {entry.actor} · {entry.operation} · {formatDate(entry.createdAt)}
                </p>
                <p className="mt-1">{entry.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
