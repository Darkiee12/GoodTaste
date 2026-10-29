import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { CollapsiblePanel } from "@/components/admin/dish/CollapsiblePanel";
import {
  actorSummary,
  isKnownOperation,
  operationLabel,
  type ResolvedActor,
} from "@/components/admin/dish/presentation";
import { AdminErrorState, AdminGhostButton } from "@/components/admin/ui";
import { formatAdminDate } from "@/shared/format";
import type { Locale, Messages } from "@/shared/i18n";

export interface RevisionTimelineItem extends ResolvedActor {
  readonly id: string;
  readonly operation: string;
  readonly summary: string;
  readonly createdAt: Date | string;
}

export interface RevisionTimelinePage {
  readonly revisions: ReadonlyArray<RevisionTimelineItem>;
  readonly nextCursor: string | null;
}

const PAGE_SIZE = 20;

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

const OPERATION_DOT_CLASS: ReadonlyMap<string, string> = new Map([
  ["created", "bg-brand-blue"],
  ["status_changed", "bg-food-orange"],
  ["name_added", "bg-brand-blue"],
  ["description_updated", "bg-brand-blue"],
  ["ingredient_linked", "bg-green-700"],
  ["place_linked", "bg-green-700"],
  ["category_linked", "bg-green-700"],
  ["cuisine_linked", "bg-green-700"],
  ["import_applied", "bg-green-700"],
  ["note_added", "bg-muted"],
]);

const DOT_FALLBACK_CLASS = "bg-muted";

const dotClassFor = (operation: string): string =>
  OPERATION_DOT_CLASS.get(operation) ?? DOT_FALLBACK_CLASS;

const dedupeAppended = (
  previous: ReadonlyArray<RevisionTimelineItem>,
  incoming: ReadonlyArray<RevisionTimelineItem>,
): ReadonlyArray<RevisionTimelineItem> => {
  const seen = new Set(previous.map((entry) => entry.id));
  const fresh = incoming.filter((entry) => !seen.has(entry.id));

  return [...previous, ...fresh];
};

export function RevisionTimeline({
  dishId,
  lang,
  copy,
  fetchPage,
}: {
  readonly dishId: string;
  readonly lang: Locale;
  readonly copy: Messages;
  readonly fetchPage: (input: {
    readonly dishId: string;
    readonly limit: number;
    readonly cursor: string | null;
  }) => Promise<RevisionTimelinePage>;
}): ReactNode {
  const firstPage = useQuery({
    queryKey: ["admin", "dish-revision-history", dishId],
    queryFn: () => fetchPage({ dishId, limit: PAGE_SIZE, cursor: null }),
    staleTime: 30_000,
  });

  const [extraPages, setExtraPages] = useState<ReadonlyArray<RevisionTimelinePage>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMore = useMutation({
    mutationFn: (cursor: string) => fetchPage({ dishId, limit: PAGE_SIZE, cursor }),
    onSuccess: (page) => {
      setExtraPages((previous) => [...previous, page]);
      setLoadError(null);
    },
    onError: () => {
      setLoadError(copy.adminLoadFailed);
    },
  });

  const items = useMemo(() => {
    const initial = firstPage.data?.revisions ?? [];
    const appended = extraPages.flatMap((page) => page.revisions);

    return dedupeAppended(initial, appended);
  }, [firstPage.data, extraPages]);

  const lastExtra = extraPages[extraPages.length - 1];

  const nextCursor =
    lastExtra === undefined ? (firstPage.data?.nextCursor ?? null) : lastExtra.nextCursor;

  const handleLoadOlder = (): void => {
    if (nextCursor === null || loadMore.isPending) {
      return;
    }

    setLoadError(null);
    loadMore.mutate(nextCursor);
  };

  const handleRetry = (): void => {
    setExtraPages([]);
    setLoadError(null);
    void firstPage.refetch();
  };

  return (
    <CollapsiblePanel
      title={copy.adminRevisions}
      defaultOpen
      badge={
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
          {items.length}
        </span>
      }
    >
      {firstPage.isPending ? (
        <output className="flex min-w-0 flex-col gap-2">
          <span className="sr-only">{pick(lang, "Loading…", "Đang tải…")}</span>
          <div aria-hidden="true" className="h-4 w-full animate-pulse rounded-lg bg-cream" />
          <div aria-hidden="true" className="h-4 w-5/6 animate-pulse rounded-lg bg-cream" />
          <div aria-hidden="true" className="h-4 w-2/3 animate-pulse rounded-lg bg-cream" />
        </output>
      ) : null}
      {firstPage.isError ? (
        <AdminErrorState
          message={copy.adminLoadFailed}
          retryLabel={copy.commonRetry}
          onRetry={handleRetry}
          pending={firstPage.isFetching}
        />
      ) : null}
      {!firstPage.isPending && !firstPage.isError && items.length === 0 ? (
        <p className="text-sm text-muted">
          {pick(lang, "No editorial activity recorded.", "Chưa ghi nhận hoạt động biên tập.")}
        </p>
      ) : null}
      {!firstPage.isPending && !firstPage.isError && items.length > 0 ? (
        <section
          aria-label={copy.adminRevisions}
          className="max-h-96 min-w-0 overflow-y-auto md:max-h-[30rem]"
        >
          <ol className="relative ml-1 min-w-0 space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border-soft">
            {items.map((entry) => {
              const actor = actorSummary(entry, lang);
              const instant = new Date(entry.createdAt);

              return (
                <li key={entry.id} className="relative min-w-0 pl-6">
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1.5 size-2.5 rounded-full ${dotClassFor(entry.operation)}`}
                  />
                  <p className="min-w-0 text-sm break-words">
                    <span className="font-semibold">{operationLabel(entry.operation, lang)}</span>
                    <span className="text-muted"> · {actor.primary}</span>
                  </p>
                  <p className="min-w-0 text-xs text-muted break-words">
                    <time
                      dateTime={instant.toISOString()}
                      title={formatAdminDate(entry.createdAt, lang)}
                    >
                      {formatAdminDate(entry.createdAt, lang)}
                    </time>
                    {actor.secondary !== null ? <span> · {actor.secondary}</span> : null}
                  </p>
                  <p className="mt-1 min-w-0 text-sm break-words">{entry.summary}</p>
                  {!isKnownOperation(entry.operation) || actor.needsDetails ? (
                    <details className="mt-1 text-xs text-muted">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                        {pick(lang, "Details", "Chi tiết")}
                      </summary>
                      <p className="break-words">
                        {!isKnownOperation(entry.operation) ? (
                          <span className="block">operation: {entry.operation}</span>
                        ) : null}
                        {actor.needsDetails ? (
                          <span className="block">actor: {actor.raw}</span>
                        ) : null}
                      </p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {loadError !== null ? (
            <div className="mt-3">
              <AdminErrorState
                message={loadError}
                retryLabel={copy.commonRetry}
                onRetry={handleLoadOlder}
                pending={loadMore.isPending}
              />
            </div>
          ) : null}
          {nextCursor !== null ? (
            <div className="mt-3">
              <AdminGhostButton
                type="button"
                disabled={loadMore.isPending}
                aria-busy={loadMore.isPending}
                onClick={handleLoadOlder}
              >
                {loadMore.isPending
                  ? pick(lang, "Loading…", "Đang tải…")
                  : pick(lang, "Load older activity", "Tải thêm hoạt động cũ")}
              </AdminGhostButton>
            </div>
          ) : null}
        </section>
      ) : null}
    </CollapsiblePanel>
  );
}
