import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminDishDetailFn,
  adminPublicationCheckFn,
  adminSurfaceFn,
  adminUpdateDishStatusFn,
} from "@/modules/food-discovery/admin.functions";
import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import { getSessionFn } from "@/modules/user/session.functions";
import { formatAdminDate } from "@/shared/format";
import { localeSearchSchema, messagesFor, type Locale, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/dishes/$dishId")({
  validateSearch: localeSearchSchema,
  loaderDeps: ({ search }) => ({ locale: search.lang }),
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

const DISH_STATUSES = ["draft", "review", "published", "archived"] as const;

const formatDate = (value: DisplayTimestamp, lang: Locale): string => formatAdminDate(value, lang);

function DishStatusEditor({
  dishId,
  initialStatus,
}: {
  readonly dishId: string;
  readonly initialStatus: string;
}) {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const router = useRouter();
  const [selected, setSelected] = useState(initialStatus);
  const [applied, setApplied] = useState(initialStatus);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const publication = useQuery({
    queryKey: ["admin", "publication-check", dishId],
    queryFn: () => adminPublicationCheckFn({ data: { dishId } }),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (next: string) => {
      const status = DISH_STATUSES.find((entry) => entry === next) ?? "draft";

      return adminUpdateDishStatusFn({ data: { dishId, status } });
    },
    onSuccess: (result) => {
      setApplied(result.status);
      setSaved(true);
      setSaveError(null);
      void router.invalidate();
    },
    onError: (error) => {
      setSaved(false);
      setSaveError(error instanceof Error ? error.message : copy.adminStatusUpdateFailed);
    },
  });

  const check = publication.data ?? null;
  const publishBlocked = selected === "published" && check !== null && !check.publishable;
  const checkingPublish = selected === "published" && publication.isPending;
  const saveDisabled = save.isPending || publishBlocked || checkingPublish;

  const handleSave = (): void => {
    if (selected === "published" && applied !== "published") {
      const confirmed = window.confirm(copy.adminPublishConfirm);

      if (!confirmed) {
        return;
      }
    }

    setSaved(false);
    setSaveError(null);
    save.mutate(selected);
  };

  return (
    <section
      aria-labelledby="admin-dish-status"
      className="rounded-2xl border border-border-soft bg-white p-4"
    >
      <h2 id="admin-dish-status" className="text-lg font-bold">
        {copy.adminStatus}
      </h2>

      <div className="mt-2 flex flex-col gap-2">
        <label htmlFor="admin-dish-status-select" className="text-sm font-semibold">
          {copy.adminStatus}
        </label>

        <select
          id="admin-dish-status-select"
          value={selected}
          onChange={(event) => {
            const next = DISH_STATUSES.find((entry) => entry === event.target.value);

            if (next !== undefined) {
              setSelected(next);
            }
          }}
          className="min-h-11 rounded-lg border border-border-soft bg-white px-3 py-2 text-sm"
        >
          {DISH_STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {statusLabel(entry, copy)}
            </option>
          ))}
        </select>

        {selected === "published" ? (
          <div className="rounded-lg bg-cream px-3 py-2 text-sm" aria-live="polite">
            <p className="font-semibold">{copy.adminPublicationChecklist}</p>

            {publication.isPending ? <p>{copy.adminCheckingPublication}</p> : null}

            {publication.isError ? (
              <div>
                <p role="alert">{copy.adminLoadFailed}</p>

                <p>
                  <button
                    type="button"
                    onClick={() => {
                      void publication.refetch();
                    }}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border-soft bg-white px-4 py-2 text-sm font-semibold hover:bg-cream"
                  >
                    {copy.adminRetryChecklist}
                  </button>
                </p>
              </div>
            ) : null}

            {check !== null && check.publishable ? <p>{copy.adminPublicationReady}</p> : null}

            {check !== null && !check.publishable ? (
              <div>
                <p>{copy.adminPublishBlocked}</p>

                <ul className="mt-1 list-disc pl-5">
                  {check.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saveDisabled}
            aria-busy={save.isPending}
            onClick={handleSave}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {copy.authSave}
          </button>
        </div>

        <div aria-live="polite">
          {saved ? <p className="text-sm font-semibold">{copy.authSaved}</p> : null}

          {saveError !== null ? (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            >
              {saveError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

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

      <DishStatusEditor key={dish.id} dishId={dish.id} initialStatus={dish.status} />

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
                  {entry.author} · {entry.noteKind} · {formatDate(entry.createdAt, lang)}
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
                  {entry.actor} · {entry.operation} · {formatDate(entry.createdAt, lang)}
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
