import type { ReactNode } from "react";

import { AdminPageHeader, type DishReturnStatus } from "@/components/admin/page-header";
import type { Locale } from "@/shared/i18n";

/**
 * Dish-detail heading: breadcrumb trail plus title, one-line count summary,
 * and the status badge. No Back link — the breadcrumb's Dishes ancestor
 * restores the caller's list context (status filter + cursor + lang) via
 * `backSearch`, falling back to the canonical parent for deep links.
 */
export function DishHeader({
  backSearch,
  dishesLabel,
  labLabel,
  lang,
  statusBadge,
  summary,
  title,
}: {
  readonly backSearch: { readonly cursor: string; readonly status: DishReturnStatus };
  readonly dishesLabel: string;
  readonly labLabel: string;
  readonly lang: Locale;
  readonly statusBadge: ReactNode;
  readonly summary: string;
  readonly title: string;
}): ReactNode {
  return (
    <AdminPageHeader
      lang={lang}
      breadcrumbs={[
        { label: labLabel, to: "/admin", search: { lang } },
        {
          label: dishesLabel,
          to: "/admin/dishes",
          search: { lang, status: backSearch.status, cursor: backSearch.cursor },
        },
        { label: title },
      ]}
      title={title}
      description={summary}
      badge={statusBadge}
    />
  );
}
