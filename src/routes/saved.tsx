import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { getDishSummariesFn } from "@/modules/food-discovery/food.functions";
import {
  favoriteIdsQueryKey,
  SaveDishButton,
  useFavoriteIds,
} from "@/modules/user/components/save-dish-button";
import { listFavoritesFn, removeFavoriteFn } from "@/modules/user/profile.functions";
import type { SessionState } from "@/modules/user/session.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

/**
 * Loader boundary for favorite rows: keep only the decimal dish id the UI
 * needs, validated here so row-shape drift fails fast instead of rendering
 * half-parsed favorites.
 */
const savedDishSchema = z.object({ dish_id: z.string().regex(/^[0-9]+$/) });

export const Route = createFileRoute("/saved")({
  validateSearch: localeSearchSchema,
  beforeLoad: async ({ context, search }) => {
    if (context.session.status === "signed-out") {
      throw redirect({ to: "/sign-in", search: { returnTo: "/saved", lang: search.lang } });
    }

    if (context.session.status === "unavailable") {
      // SAFETY: literal unavailable marker for the component's discriminated
      // union branch; no untrusted input is asserted.
      return { user: null, unavailable: true } as const;
    }

    // SAFETY: literal loaded marker; identity comes from the verified root context.
    return { user: context.session.user, unavailable: false } as const;
  },
  loader: async ({ context }) => {
    if ("unavailable" in context && context.unavailable) {
      // SAFETY: literal unavailable marker with an empty dish list; the list
      // shape matches the loaded branch so the component narrows safely.
      return { dishIds: [], unavailable: true } as const;
    }

    const favorites = await listFavoritesFn({ data: { limit: 50 } });

    // SAFETY: literal loaded marker; dish ids are validated by
    // savedDishSchema at the loader boundary.
    return {
      dishIds: favorites.map((entry) => savedDishSchema.parse(entry).dish_id),
      unavailable: false,
    } as const;
  },
  pendingComponent: SavedPending,
  errorComponent: SavedError,
  notFoundComponent: SavedMissing,
  component: SavedDishes,
});

function SavedPending() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-10">
      <output className="block text-lg font-semibold text-muted">Loading saved dishes…</output>
    </div>
  );
}

function SavedError({ reset }: { readonly reset: () => void }) {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-10">
      <p
        role="alert"
        className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
      >
        Could not load your saved dishes.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
      >
        {copy.recRetry}
      </button>
    </div>
  );
}

function SavedMissing() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-10">
      <output className="block rounded-xl border-2 border-border-soft bg-white px-4 py-3 text-sm font-bold text-ink">
        This page is not available.
      </output>
    </div>
  );
}

function SavedDishes() {
  const { lang } = rootRoute.useSearch();
  const { session } = rootRoute.useRouteContext();
  const loaderData = Route.useLoaderData();

  if ("unavailable" in loaderData && loaderData.unavailable) {
    return (
      <div
        className="mx-auto w-full max-w-2xl px-5 pt-10"
        style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}
      >
        <h1 className="font-display text-[clamp(2.25rem,7vw,3.5rem)] leading-none tracking-wide text-balance">
          Saved dishes
        </h1>
        <p role="note" className="mt-4 max-w-[60ch] text-base font-semibold text-ink">
          Sign-in status is unavailable — saving is paused, discovery still works. Try again
          shortly; we did not sign you out.
        </p>
      </div>
    );
  }

  return <SavedList initialIds={loaderData.dishIds} lang={lang} session={session} />;
}

function SavedList({
  initialIds,
  lang,
  session,
}: {
  readonly initialIds: ReadonlyArray<string>;
  readonly lang: Locale;
  readonly session: SessionState;
}) {
  // Authoritative ids: the loader paints first, then this shared query owns
  // updates — removals invalidate the same key every SaveDishButton writes,
  // so the list, cards, and detail pages can never disagree.
  const idsQuery = useFavoriteIds(session);

  const dishIds = idsQuery.data ?? [...initialIds];

  const summaries = useQuery({
    queryKey: ["favorites", "summaries", lang, dishIds.join(",")],
    queryFn: () =>
      getDishSummariesFn({ data: { ids: [...dishIds], locale: lang } }).then((rows) => [...rows]),
    enabled: dishIds.length > 0,
    staleTime: 60_000,
    retry: 1,
  });

  const byId = new Map((summaries.data ?? []).map((entry) => [entry.id, entry] as const));

  return (
    <div
      className="mx-auto w-full max-w-2xl px-5 pt-10"
      style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}
    >
      <p className="mb-4 text-sm font-semibold">
        <Link
          to="/"
          search={{ lang }}
          className="text-brand-blue-hover underline underline-offset-4"
        >
          FeastJourney
        </Link>
      </p>

      <h1 className="font-display text-[clamp(2.25rem,7vw,3.5rem)] leading-none tracking-wide text-balance">
        Saved dishes
      </h1>

      {idsQuery.isPending ? (
        <output className="mt-4 block text-base text-muted">Loading saved dishes…</output>
      ) : null}

      {idsQuery.isError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
        >
          Could not refresh your saved dishes. Showing the last loaded list.
        </p>
      ) : null}

      {dishIds.length === 0 && !idsQuery.isPending ? (
        <p className="mt-4 max-w-[60ch] text-base text-muted">
          No saved dishes yet. Open any dish and choose Save dish to keep it here.
        </p>
      ) : null}

      {summaries.isPending && dishIds.length > 0 ? (
        <output className="mt-6 block text-base text-muted">Loading dish details…</output>
      ) : null}

      {summaries.isError ? (
        <p
          role="alert"
          className="mt-6 rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
        >
          Could not load details for your saved dishes. Try again shortly.
        </p>
      ) : null}

      <ul className="mt-6 grid gap-4">
        {dishIds.map((dishId) => {
          const summary = byId.get(dishId);

          if (summary === undefined) {
            if (summaries.isPending || summaries.isError) {
              return null;
            }

            return <UnavailableRow key={dishId} dishId={dishId} lang={lang} />;
          }

          return (
            <FavoriteRow
              key={dishId}
              dishId={dishId}
              slug={summary.slug}
              title={summary.name ?? summary.englishName ?? summary.slug}
              lang={lang}
            />
          );
        })}
      </ul>
    </div>
  );
}

function UnavailableRow({ dishId, lang }: { readonly dishId: string; readonly lang: Locale }) {
  const { session } = rootRoute.useRouteContext();

  return (
    <li className="rounded-2xl border border-border-soft bg-white p-6">
      <h2 className="text-lg leading-tight font-extrabold">Dish {dishId}</h2>
      <p role="note" className="mt-2 text-sm text-muted">
        This dish is no longer in the public catalog, so its details are unavailable.
      </p>
      <div className="mt-3">
        <SaveDishButton dishId={dishId} lang={lang} returnTo="/saved" session={session} />
      </div>
    </li>
  );
}

function FavoriteRow({
  dishId,
  slug,
  title,
  lang,
}: {
  readonly dishId: string;
  readonly slug: string;
  readonly title: string;
  readonly lang: Locale;
}) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  const remove = useMutation({
    mutationFn: () => removeFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      setFailed(false);
      void queryClient.invalidateQueries({ queryKey: [...favoriteIdsQueryKey] });
    },
    onError: () => {
      setFailed(true);
    },
  });

  return (
    <li className="rounded-2xl border border-border-soft bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg leading-tight font-extrabold">
          <Link
            to="/dishes/$dishId"
            params={{ dishId: slug }}
            search={{ lang }}
            className="underline decoration-food-orange/60 underline-offset-4 hover:text-food-orange-strong"
          >
            {title}
          </Link>
        </h2>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            remove.mutate();
          }}
          disabled={remove.isPending}
          aria-busy={remove.isPending}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-danger hover:text-danger disabled:cursor-wait disabled:opacity-70"
        >
          {remove.isPending ? "Removing…" : "Remove"}
        </button>
      </div>

      {failed && !remove.isPending ? (
        <p
          role="alert"
          className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold text-danger"
        >
          Could not remove this dish. It is still saved.
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              remove.mutate();
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-danger bg-white px-4 text-sm font-bold text-danger transition hover:bg-danger hover:text-white"
          >
            Retry
          </button>
        </p>
      ) : null}
    </li>
  );
}
