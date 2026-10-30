import type { ReactNode } from "react";

import { CollapsiblePanel } from "@/components/admin/dish/CollapsiblePanel";
import { isVerifiedHttpsUrl } from "@/components/admin/dish/presentation";
import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import type { Locale, Messages } from "@/shared/i18n";

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

export function DishProvenance({
  dish,
  lang,
  copy,
}: {
  readonly dish: DishProfile;
  readonly lang: Locale;
  readonly copy: Messages;
}): ReactNode {
  return (
    <CollapsiblePanel
      title={copy.adminProvenance}
      defaultOpen={dish.sources.length <= 3}
      badge={
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
          {dish.sources.length}
        </span>
      }
    >
      {dish.sources.length === 0 ? (
        <p className="text-sm text-muted">
          {pick(lang, "No provenance recorded.", "Chưa ghi nhận xuất xứ.")}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2 text-sm">
          {dish.sources.map((entry) => (
            <li
              key={entry.recordId}
              className="min-w-0 rounded-lg border border-border-soft bg-cream px-3 py-2"
            >
              <p className="min-w-0 font-semibold break-words">
                {entry.provider} · {entry.externalId}
              </p>
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                <span>
                  {copy.adminLicense}: {entry.license ?? "—"}
                </span>
                {entry.attribution !== null ? <span>{entry.attribution}</span> : null}
              </p>
              {isVerifiedHttpsUrl(entry.canonicalUrl) ? (
                <a
                  href={entry.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block min-h-11 max-w-full truncate py-2 font-semibold text-brand-blue underline"
                >
                  {entry.canonicalUrl}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
