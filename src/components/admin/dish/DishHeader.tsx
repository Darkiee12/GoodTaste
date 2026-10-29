import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Locale } from "@/shared/i18n";

export function DishHeader({
  lang,
  backLabel,
  crumbLabLabel,
  crumbDishesLabel,
  title,
  summary,
  statusBadge,
}: {
  readonly lang: Locale;
  readonly backLabel: string;
  readonly crumbLabLabel: string;
  readonly crumbDishesLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly statusBadge: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <nav aria-label={lang === "vi" ? "Đường dẫn" : "Breadcrumb"}>
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <li>
            <Link
              to="/admin"
              search={{ lang }}
              className="inline-flex min-h-11 items-center rounded-lg px-1 py-2 font-semibold text-brand-blue underline"
            >
              {crumbLabLabel}
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted">
            /
          </li>
          <li>
            <Link
              to="/admin/dishes"
              search={{ lang, status: "review", cursor: "0" }}
              className="inline-flex min-h-11 items-center rounded-lg px-1 py-2 font-semibold text-brand-blue underline"
            >
              {crumbDishesLabel}
            </Link>
          </li>
          <li aria-hidden="true" className="text-muted">
            /
          </li>
          <li aria-current="page" className="min-w-0 truncate px-1 py-2 font-semibold">
            {title}
          </li>
        </ol>
      </nav>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display min-w-0 text-4xl tracking-wide break-words">{title}</h1>
          <p className="min-w-0 text-sm text-muted break-words">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge}
          <Link
            to="/admin/dishes"
            search={{ lang, status: "review", cursor: "0" }}
            className="inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-semibold text-brand-blue underline"
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
