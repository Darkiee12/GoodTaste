import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { getDishFn } from "@/modules/food-discovery/food.functions";
import { addFavoriteFn, listFavoritesFn, removeFavoriteFn } from "@/modules/user/profile.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const favoriteExistsSchema = z.object({ _tag: z.literal("FavoriteExists") });

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

type SaveVisualState = "unknown" | "saved" | "not-saved" | "pending" | "failed";

const initialSaveState = (initialSaved: boolean | undefined): SaveVisualState => {
  if (initialSaved === undefined) {
    return "unknown";
  }

  if (initialSaved) {
    return "saved";
  }

  return "not-saved";
};

const saveLabel = (state: SaveVisualState): string => {
  if (state === "saved") {
    return "Saved";
  }

  if (state === "pending") {
    return "Saving…";
  }

  if (state === "failed") {
    return "Retry save";
  }

  return "Save dish";
};

/**
 * Member-only save toggle. Guests are sent to sign-in with a returnTo (never
 * an auth wall on discovery itself); every other state is explicit — no
 * optimistic label flips. Reused by dish cards, dish detail, and /saved rows.
 */
export function SaveDishButton({
  dishId,
  lang,
  returnTo,
  initialSaved,
}: {
  readonly dishId: string;
  readonly lang: Locale;
  readonly returnTo: string;
  readonly initialSaved?: boolean;
}) {
  const { session } = rootRoute.useRouteContext();
  const navigate = Route.useNavigate();

  const [state, setState] = useState<SaveVisualState>(() => initialSaveState(initialSaved));

  const save = useMutation({
    mutationFn: () => addFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      setState("saved");
    },
    onError: (error) => {
      setState(favoriteExistsSchema.safeParse(error).success ? "saved" : "failed");
    },
  });

  const unsave = useMutation({
    mutationFn: () => removeFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      setState("not-saved");
    },
    onError: () => {
      setState("failed");
    },
  });

  const pending = save.isPending || unsave.isPending;

  const onToggle = (): void => {
    if (pending) {
      return;
    }

    if (session.status !== "signed-in") {
      void navigate({ to: "/sign-in", search: { returnTo, lang } });

      return;
    }

    setState("pending");

    if (state === "saved") {
      unsave.mutate();
    } else {
      save.mutate();
    }
  };

  if (session.status === "unavailable") {
    return (
      <p role="note" className="text-sm font-semibold text-muted">
        Sign-in status is unavailable — saving is paused, discovery still works.
      </p>
    );
  }

  const label = saveLabel(state);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={state === "saved"}
      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white disabled:cursor-wait disabled:opacity-70 aria-pressed:border-food-orange-strong aria-pressed:bg-food-orange-strong aria-pressed:text-white"
    >
      {label}
    </button>
  );
}

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
  const { dishIds, unavailable } = Route.useLoaderData();

  if (unavailable) {
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

      {dishIds.length === 0 ? (
        <p className="mt-4 max-w-[60ch] text-base text-muted">
          No saved dishes yet. Open any dish and choose Save dish to keep it here.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {dishIds.map((dishId) => (
            <FavoriteRow key={dishId} dishId={dishId} lang={lang} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FavoriteRow({ dishId, lang }: { readonly dishId: string; readonly lang: Locale }) {
  const queryClient = useQueryClient();

  const dish = useQuery({
    queryKey: ["dish", dishId, lang],
    queryFn: () => getDishFn({ data: { id: dishId, locale: lang } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const remove = useMutation({
    mutationFn: () => removeFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dish", dishId] });
    },
  });

  const title = dish.data
    ? (dish.data.name ?? dish.data.englishName ?? dish.data.slug)
    : `Dish ${dishId}`;

  return (
    <li className="rounded-2xl border border-border-soft bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg leading-tight font-extrabold">
          {dish.data ? (
            <Link
              to="/dishes/$dishId"
              params={{ dishId: dish.data.slug }}
              search={{ lang }}
              className="underline decoration-food-orange/60 underline-offset-4 hover:text-food-orange-strong"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        <button
          type="button"
          onClick={() => {
            remove.mutate();
          }}
          disabled={remove.isPending}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-danger hover:text-danger disabled:cursor-wait disabled:opacity-70"
        >
          {remove.isPending ? "Removing…" : "Remove"}
        </button>
      </div>

      {dish.isPending ? <p className="mt-2 text-sm text-muted">Loading dish…</p> : null}
      {dish.isError ? (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          Could not load this dish. It may have been unpublished.
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          Could not remove this dish. Try again.
        </p>
      ) : null}
    </li>
  );
}
