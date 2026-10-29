import type { ReactNode } from "react";

import { CollapsiblePanel } from "@/components/admin/dish/CollapsiblePanel";
import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import type { Locale, Messages } from "@/shared/i18n";

const pick = (lang: Locale, en: string, vi: string): string => (lang === "vi" ? vi : en);

export function DishIdentity({
  dish,
  lang,
  copy,
}: {
  readonly dish: DishProfile;
  readonly lang: Locale;
  readonly copy: Messages;
}): ReactNode {
  const englishName = dish.englishName ?? null;
  const canonicalName = dish.name ?? englishName ?? dish.slug;

  return (
    <CollapsiblePanel
      title={copy.adminNames}
      defaultOpen
      badge={
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
          {dish.nativeNames.length}
        </span>
      }
    >
      <dl className="flex min-w-0 flex-col gap-2 text-sm">
        <div className="min-w-0">
          <dt className="font-semibold">{pick(lang, "Display name", "Tên hiển thị")}</dt>
          <dd className="min-w-0 break-words">{canonicalName}</dd>
        </div>
        {englishName !== null ? (
          <div className="min-w-0">
            <dt className="font-semibold">{pick(lang, "English name", "Tên tiếng Anh")}</dt>
            <dd className="min-w-0 break-words">{englishName}</dd>
          </div>
        ) : (
          <p className="text-muted">
            {pick(lang, "No English name recorded.", "Chưa có tên tiếng Anh.")}
          </p>
        )}
      </dl>
      {dish.nativeNames.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {pick(
            lang,
            "No additional native names recorded.",
            "Chưa ghi nhận tên bản địa nào khác.",
          )}
        </p>
      ) : (
        <ul className="mt-2 flex min-w-0 flex-col gap-1 text-sm">
          {dish.nativeNames.map((entry) => (
            <li key={`${entry.languageTag}:${entry.name}`} className="min-w-0 break-words">
              <span className="mr-2 inline-block rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
                {entry.languageTag}
              </span>
              {entry.name}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-3 text-sm font-bold">{copy.adminDescriptions}</h3>
      {dish.description !== null ? (
        <p className="mt-1 min-w-0 text-sm break-words">
          {dish.description}
          {dish.descriptionLanguage !== null ? (
            <span className="ml-2 inline-block rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-food-orange-dark">
              {dish.descriptionLanguage}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          {pick(lang, "No description recorded.", "Chưa có mô tả.")}
        </p>
      )}
    </CollapsiblePanel>
  );
}
