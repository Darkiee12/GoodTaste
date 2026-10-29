import type { ReactNode } from "react";

import { CollapsiblePanel } from "@/components/admin/dish/CollapsiblePanel";
import {
  authorSummary,
  noteKindLabel,
  type ResolvedAuthor,
} from "@/components/admin/dish/presentation";
import { formatAdminDate } from "@/shared/format";
import type { Locale, Messages } from "@/shared/i18n";

export interface DishNoteItem extends ResolvedAuthor {
  readonly id: string;
  readonly noteKind: string;
  readonly note: string;
  readonly createdAt: Date | string;
}

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

export function DishNotes({
  notes,
  lang,
  copy,
}: {
  readonly notes: ReadonlyArray<DishNoteItem>;
  readonly lang: Locale;
  readonly copy: Messages;
}): ReactNode {
  return (
    <CollapsiblePanel
      title={copy.adminNotes}
      defaultOpen={notes.length > 0}
      badge={
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
          {notes.length}
        </span>
      }
    >
      {notes.length === 0 ? (
        <p className="text-sm text-muted">
          {pick(lang, "No editorial notes.", "Chưa có ghi chú biên tập.")}
        </p>
      ) : (
        <section aria-label={copy.adminNotes} className="max-h-80 min-w-0 overflow-y-auto">
          <ul className="flex min-w-0 flex-col gap-2">
            {notes.map((entry) => {
              const author = authorSummary(entry, lang);

              return (
                <li
                  key={entry.id}
                  className="min-w-0 rounded-lg border border-border-soft bg-cream px-3 py-2 text-sm"
                >
                  <p className="min-w-0 break-words font-semibold">
                    {author.primary} · {noteKindLabel(entry.noteKind, lang)} ·{" "}
                    <time dateTime={new Date(entry.createdAt).toISOString()}>
                      {formatAdminDate(entry.createdAt, lang)}
                    </time>
                  </p>
                  {author.secondary !== null ? (
                    <p className="min-w-0 text-xs text-muted break-words">{author.secondary}</p>
                  ) : null}
                  <p className="mt-1 min-w-0 break-words">{entry.note}</p>
                  {author.needsDetails ? (
                    <details className="mt-1 text-xs text-muted">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                        {pick(lang, "Details", "Chi tiết")}
                      </summary>
                      <p className="break-words">{author.raw}</p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </CollapsiblePanel>
  );
}
