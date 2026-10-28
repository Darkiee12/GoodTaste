import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useReducer } from "react";
import { z } from "zod";

import { addFavoriteFn, listFavoritesFn, removeFavoriteFn } from "@/modules/user/profile.functions";
import type { SessionState } from "@/modules/user/session.functions";
import type { Locale } from "@/shared/i18n";

/**
 * Shared member-only save toggle. Status always derives from the
 * authoritative favorites query (`favoriteIdsQueryKey`), so every copy of
 * the same dish card agrees and a page reload restores the true state
 * instead of guessing "not saved". Guests are sent to sign-in with a
 * return path; discovery itself never requires an account.
 */

export const favoriteIdsQueryKey = ["favorites", "ids"] as const;

const favoriteIdSchema = z.object({ dish_id: z.string().regex(/^[0-9]+$/) });

const favoriteExistsSchema = z.object({ _tag: z.literal("FavoriteExists") });

const favoriteNotFoundSchema = z.object({ _tag: z.literal("FavoriteNotFound") });

export function useFavoriteIds(session: SessionState) {
  return useQuery({
    queryKey: favoriteIdsQueryKey,
    queryFn: async (): Promise<Array<string>> => {
      const rows = await listFavoritesFn({ data: { limit: 50 } });

      return rows.map((entry) => favoriteIdSchema.parse(entry).dish_id);
    },
    enabled: session.status === "signed-in",
    staleTime: 60_000,
    retry: 1,
  });
}

export const invalidateFavoriteIds = (queryClient: {
  invalidateQueries: (filters: { queryKey: ReadonlyArray<string> }) => void;
}): void => {
  queryClient.invalidateQueries({ queryKey: [...favoriteIdsQueryKey] });
};

/**
 * Pure button state machine. `confirmed` is the last server-confirmed value
 * (`undefined` before the favorites query resolves); `pending` is the
 * in-flight action; `failedAction` remembers what to retry. Failures never
 * touch `confirmed`, so retrying a failed removal attempts removal again —
 * never a save.
 */
export interface SaveButtonState {
  readonly confirmed: boolean | undefined;
  readonly pending: "save" | "unsave" | null;
  readonly failedAction: "save" | "unsave" | null;
}

export type SaveButtonEvent =
  | { readonly type: "resolved"; readonly saved: boolean }
  | { readonly type: "save-requested" }
  | { readonly type: "unsave-requested" }
  | { readonly type: "save-succeeded" }
  | { readonly type: "unsave-succeeded" }
  | { readonly type: "save-failed" }
  | { readonly type: "unsave-failed" }
  | { readonly type: "dismiss-error" };

export const initialSaveButtonState: SaveButtonState = {
  confirmed: undefined,
  pending: null,
  failedAction: null,
};

export const saveButtonTransition = (
  state: SaveButtonState,
  event: SaveButtonEvent,
): SaveButtonState => {
  switch (event.type) {
    case "resolved": {
      if (state.pending !== null) {
        return state;
      }

      if (state.confirmed === event.saved) {
        return state;
      }

      return { confirmed: event.saved, pending: null, failedAction: null };
    }

    case "save-requested": {
      if (state.pending !== null || state.confirmed === true) {
        return state;
      }

      return { ...state, pending: "save", failedAction: null };
    }

    case "unsave-requested": {
      if (state.pending !== null || state.confirmed === false) {
        return state;
      }

      return { ...state, pending: "unsave", failedAction: null };
    }

    case "save-succeeded": {
      return { confirmed: true, pending: null, failedAction: null };
    }

    case "unsave-succeeded": {
      return { confirmed: false, pending: null, failedAction: null };
    }

    case "save-failed": {
      return { ...state, pending: null, failedAction: "save" };
    }

    case "unsave-failed": {
      return { ...state, pending: null, failedAction: "unsave" };
    }

    case "dismiss-error": {
      if (state.failedAction === null) {
        return state;
      }

      return { ...state, failedAction: null };
    }

    default: {
      return state;
    }
  }
};

const saveLabel = (state: SaveButtonState): string => {
  if (state.pending === "save") {
    return "Saving…";
  }

  if (state.pending === "unsave") {
    return "Removing…";
  }

  if (state.confirmed === true) {
    return "Saved";
  }

  if (state.failedAction !== null) {
    return "Retry";
  }

  return "Save dish";
};

export function SaveDishButton({
  dishId,
  lang,
  returnTo,
  session,
}: {
  readonly dishId: string;
  readonly lang: Locale;
  readonly returnTo: string;
  readonly session: SessionState;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(saveButtonTransition, initialSaveButtonState);

  const favorites = useFavoriteIds(session);

  const serverSaved = favorites.data === undefined ? undefined : favorites.data.includes(dishId);

  useEffect(() => {
    if (serverSaved !== undefined && state.pending === null && state.confirmed !== serverSaved) {
      dispatch({ type: "resolved", saved: serverSaved });
    }
  }, [serverSaved, state.pending, state.confirmed]);

  const save = useMutation({
    mutationFn: () => addFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      dispatch({ type: "save-succeeded" });
      invalidateFavoriteIds(queryClient);
    },
    onError: (error) => {
      if (favoriteExistsSchema.safeParse(error).success) {
        dispatch({ type: "save-succeeded" });
        invalidateFavoriteIds(queryClient);

        return;
      }

      dispatch({ type: "save-failed" });
    },
  });

  const unsave = useMutation({
    mutationFn: () => removeFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      dispatch({ type: "unsave-succeeded" });
      invalidateFavoriteIds(queryClient);
    },
    onError: (error) => {
      if (favoriteNotFoundSchema.safeParse(error).success) {
        dispatch({ type: "unsave-succeeded" });
        invalidateFavoriteIds(queryClient);

        return;
      }

      dispatch({ type: "unsave-failed" });
    },
  });

  if (session.status === "unavailable") {
    return (
      <p role="note" className="text-sm font-semibold text-muted">
        Sign-in status is unavailable — saving is paused, discovery still works.
      </p>
    );
  }

  const loading = session.status === "signed-in" && favorites.isPending;
  const pending = save.isPending || unsave.isPending || state.pending !== null;

  const onToggle = (): void => {
    if (pending || loading) {
      return;
    }

    if (session.status !== "signed-in") {
      void navigate({ to: "/sign-in", search: { returnTo, lang } });

      return;
    }

    if (state.confirmed === true) {
      dispatch({ type: "unsave-requested" });
      unsave.mutate();
    } else {
      dispatch({ type: "save-requested" });
      save.mutate();
    }
  };

  const retry = (): void => {
    if (pending || loading || state.failedAction === null) {
      return;
    }

    if (state.failedAction === "save") {
      dispatch({ type: "save-requested" });
      save.mutate();
    } else {
      dispatch({ type: "unsave-requested" });
      unsave.mutate();
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={pending || loading}
        aria-pressed={state.confirmed === true}
        aria-busy={pending || loading}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white disabled:cursor-wait disabled:opacity-70 aria-pressed:border-food-orange-strong aria-pressed:bg-food-orange-strong aria-pressed:text-white"
      >
        {saveLabel(state)}
      </button>
      {state.failedAction !== null && !pending ? (
        <span role="alert" className="inline-flex items-center gap-2 text-sm font-bold text-danger">
          Could not {state.failedAction === "save" ? "save" : "remove"} this dish.
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-danger bg-white px-4 text-sm font-bold text-danger transition hover:bg-danger hover:text-white"
          >
            Retry
          </button>
        </span>
      ) : null}
    </span>
  );
}
