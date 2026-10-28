import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useReducer } from "react";
import { z } from "zod";

import {
  addFavoriteFn,
  favoriteStatusFn,
  listFavoritesFn,
  removeFavoriteFn,
} from "@/modules/user/profile.functions";
import type { SessionState } from "@/modules/user/session.functions";
import { messagesFor, type Locale, type Messages } from "@/shared/i18n";

/**
 * Shared member-only save toggle. Membership always comes from a batched,
 * per-account status query owned by the surrounding card list — never from
 * a capped recent-favorites list — so cards stay correct no matter how many
 * dishes the account has saved. Every copy of the same dish card (homepage,
 * recommendations, detail, saved list) shares the same cache entries and
 * therefore always agrees.
 *
 * Data flow per list: `useFavoriteStatus(visibleIds, userId)` once, then one
 * `SaveDishButton` per card with the resolved value. Guests are sent to
 * sign-in with a return path; discovery itself never requires an account.
 */

export const favoriteStatusQueryKey = (
  userId: string,
  ids: ReadonlyArray<string>,
): ReadonlyArray<string> => ["favorites", "status", userId, ...ids.toSorted()];

/**
 * Batched membership probe for exactly the visible dish ids. Complete for
 * the rendered set regardless of total saved count; paged saved-list
 * enumeration stays on `useFavoriteIds`.
 */
export function useFavoriteStatus(ids: ReadonlyArray<string>, userId: string | null) {
  const sortedKey = useMemo(() => ids.toSorted().join(","), [ids]);

  const sorted = useMemo(
    (): Array<string> => (sortedKey === "" ? [] : sortedKey.split(",")),
    [sortedKey],
  );

  return useQuery({
    queryKey:
      userId === null
        ? ["favorites", "status", "signed-out"]
        : favoriteStatusQueryKey(userId, sorted),
    queryFn: async (): Promise<Array<string>> => favoriteStatusFn({ data: { ids: [...sorted] } }),
    enabled: userId !== null && sorted.length > 0,
    staleTime: 60_000,
    retry: 1,
  });
}

export const favoriteIdsQueryKey = (userId: string): ReadonlyArray<string> => [
  "favorites",
  "ids",
  userId,
];

const favoriteIdSchema = z.object({ dish_id: z.string().regex(/^[0-9]+$/) });

const favoriteExistsSchema = z.object({ _tag: z.literal("FavoriteExists") });

const favoriteNotFoundSchema = z.object({ _tag: z.literal("FavoriteNotFound") });

/** Paged enumeration for the saved list itself (not for card membership). */
export function useFavoriteIds(
  userId: string | null,
  limit: number,
  offset: number,
  initialData?: Array<string>,
) {
  return useQuery({
    queryKey:
      userId === null
        ? ["favorites", "ids", "signed-out"]
        : [...favoriteIdsQueryKey(userId), `limit:${limit}`, `offset:${offset}`],
    queryFn: async (): Promise<Array<string>> => {
      const rows = await listFavoritesFn({ data: { limit, offset } });

      return rows.map((entry) => favoriteIdSchema.parse(entry).dish_id);
    },
    initialData,
    enabled: userId !== null,
    staleTime: 60_000,
    retry: 1,
  });
}

const invalidateFavoriteCaches = (
  queryClient: {
    setQueriesData: (
      filters: { queryKey: ReadonlyArray<string> },
      updater: (old: Array<string> | undefined) => Array<string>,
    ) => void;
    invalidateQueries: (filters: { queryKey: ReadonlyArray<string> }) => void;
  },
  userId: string,
  dishId: string,
  saved: boolean,
): void => {
  queryClient.setQueriesData({ queryKey: ["favorites", "status", userId] }, (old) =>
    applyMembershipToIds(old ?? [], dishId, saved),
  );
  queryClient.invalidateQueries({ queryKey: ["favorites", "status", userId] });
  queryClient.invalidateQueries({ queryKey: favoriteIdsQueryKey(userId) });
};

/** Remove all cached favorites data, e.g. immediately after sign-out. */
export const clearFavoriteCaches = (queryClient: {
  removeQueries: (filters: { queryKey: ReadonlyArray<string> }) => void;
}): void => {
  queryClient.removeQueries({ queryKey: ["favorites"] });
};

/**
 * Pure cache updater behind mutation confirmations: the server-confirmed
 * outcome is written into every matching status cache first, so a stale
 * in-flight refetch can never paint over a newer action.
 */
export const applyMembershipToIds = (
  ids: ReadonlyArray<string>,
  dishId: string,
  saved: boolean,
): Array<string> => {
  if (saved) {
    return ids.includes(dishId) ? [...ids] : [...ids, dishId];
  }

  return ids.filter((id) => id !== dishId);
};

/**
 * Pure save-button state machine. `owner` is the server-verified user id the
 * confirmed value belongs to; `confirmed` is the last server-confirmed value
 * (`undefined` before membership resolves); `pending` is the in-flight
 * action; `failedAction` remembers what to retry. Failures never touch
 * `confirmed`, so retrying a failed removal attempts removal again —
 * never a save. Server snapshots are adopted only on first load or account
 * change, never over a newer confirmed action.
 */
export interface SaveButtonState {
  readonly owner: string | null;
  readonly confirmed: boolean | undefined;
  readonly pending: "save" | "unsave" | null;
  readonly failedAction: "save" | "unsave" | null;
}

export type SaveButtonEvent =
  | { readonly type: "resolved"; readonly owner: string; readonly saved: boolean }
  | { readonly type: "identity-changed"; readonly owner: string | null }
  | { readonly type: "save-requested" }
  | { readonly type: "unsave-requested" }
  | { readonly type: "save-succeeded" }
  | { readonly type: "unsave-succeeded" }
  | { readonly type: "save-failed" }
  | { readonly type: "unsave-failed" }
  | { readonly type: "dismiss-error" };

export const initialSaveButtonState: SaveButtonState = {
  owner: null,
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
      if (event.owner !== state.owner) {
        return { owner: event.owner, confirmed: event.saved, pending: null, failedAction: null };
      }

      if (state.confirmed === undefined && state.pending === null) {
        return { ...state, confirmed: event.saved };
      }

      return state;
    }

    case "identity-changed": {
      if (event.owner === state.owner) {
        return state;
      }

      return { owner: event.owner, confirmed: undefined, pending: null, failedAction: null };
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
      return { ...state, confirmed: true, pending: null, failedAction: null };
    }

    case "unsave-succeeded": {
      return { ...state, confirmed: false, pending: null, failedAction: null };
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

const saveLabel = (state: SaveButtonState, loading: boolean, copy: Messages): string => {
  if (state.pending === "save") {
    return copy.saveDishSaving;
  }

  if (state.pending === "unsave") {
    return copy.saveDishRemoving;
  }

  if (state.confirmed === true) {
    return copy.saveDishSaved;
  }

  if (state.failedAction !== null) {
    return copy.saveDishRetry;
  }

  if (loading || state.confirmed === undefined) {
    return copy.saveDishLoading;
  }

  return copy.saveDishSave;
};

export interface SaveButtonStatus {
  /** Authoritative membership from the list-level status query. */
  readonly saved: boolean | undefined;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly refetch: () => void;
}

export interface FavoriteStatusQuery {
  readonly data: Array<string> | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
}

/** Project one dish's button status out of a list-level batched query. */
export const statusForDish = (query: FavoriteStatusQuery, dishId: string): SaveButtonStatus => ({
  saved: query.data?.includes(dishId),
  pending: query.isPending,
  failed: query.isError,
  refetch: () => {
    query.refetch();
  },
});

export function SaveDishButton({
  dishId,
  lang,
  returnTo,
  session,
  status,
}: {
  readonly dishId: string;
  readonly lang: Locale;
  readonly returnTo: string;
  readonly session: SessionState;
  readonly status: SaveButtonStatus;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(saveButtonTransition, initialSaveButtonState);
  const copy = messagesFor(lang);

  const userId = session.status === "signed-in" ? session.user.id : null;

  useEffect(() => {
    dispatch({ type: "identity-changed", owner: userId });
  }, [userId]);

  useEffect(() => {
    if (status.saved !== undefined && userId !== null) {
      dispatch({ type: "resolved", owner: userId, saved: status.saved });
    }
  }, [status.saved, userId]);

  const confirmSave = (): void => {
    if (userId !== null) {
      invalidateFavoriteCaches(queryClient, userId, dishId, true);
    }

    dispatch({ type: "save-succeeded" });
  };

  const confirmUnsave = (): void => {
    if (userId !== null) {
      invalidateFavoriteCaches(queryClient, userId, dishId, false);
    }

    dispatch({ type: "unsave-succeeded" });
  };

  const save = useMutation({
    mutationFn: () => addFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      confirmSave();
    },
    onError: (error) => {
      if (favoriteExistsSchema.safeParse(error).success) {
        confirmSave();

        return;
      }

      dispatch({ type: "save-failed" });
    },
  });

  const unsave = useMutation({
    mutationFn: () => removeFavoriteFn({ data: { dish_id: dishId } }),
    onSuccess: () => {
      confirmUnsave();
    },
    onError: (error) => {
      if (favoriteNotFoundSchema.safeParse(error).success) {
        confirmUnsave();

        return;
      }

      dispatch({ type: "unsave-failed" });
    },
  });

  if (session.status === "unavailable") {
    return (
      <p role="note" className="text-sm font-semibold text-muted">
        {copy.saveDishPaused}
      </p>
    );
  }

  if (session.status !== "signed-in") {
    return (
      <button
        type="button"
        onClick={() => {
          void navigate({ to: "/sign-in", search: { returnTo, lang } });
        }}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
      >
        {copy.saveDishSave}
      </button>
    );
  }

  const loading = status.pending && state.confirmed === undefined;
  const initialLoadFailed = status.failed && state.confirmed === undefined;
  const refreshFailed = status.failed && state.confirmed !== undefined;
  const pending = save.isPending || unsave.isPending || state.pending !== null;

  const onToggle = (): void => {
    if (pending || loading || initialLoadFailed) {
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
    if (pending || loading || initialLoadFailed || state.failedAction === null) {
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

  if (initialLoadFailed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span role="alert" className="text-sm font-bold text-danger">
          {copy.saveDishLoadError}
        </span>
        <button
          type="button"
          onClick={() => {
            status.refetch();
          }}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-danger bg-white px-4 text-sm font-bold text-danger transition hover:bg-danger hover:text-white"
        >
          {copy.saveDishRetry}
        </button>
      </span>
    );
  }

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
        {saveLabel(state, loading, copy)}
      </button>
      {refreshFailed && !pending ? (
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted">
          {copy.saveDishRefreshFailed}
          <button
            type="button"
            onClick={() => {
              status.refetch();
            }}
            className="underline underline-offset-4 hover:text-ink"
          >
            {copy.saveDishRetry}
          </button>
        </span>
      ) : null}
      {state.failedAction !== null && !pending ? (
        <span role="alert" className="inline-flex items-center gap-2 text-sm font-bold text-danger">
          {state.failedAction === "save" ? copy.saveDishSaveFailed : copy.saveDishRemoveFailed}
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-danger bg-white px-4 text-sm font-bold text-danger transition hover:bg-danger hover:text-white"
          >
            {copy.saveDishRetry}
          </button>
        </span>
      ) : null}
    </span>
  );
}
