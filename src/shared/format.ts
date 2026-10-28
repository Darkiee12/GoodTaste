import { bcp47TagFor, type Locale } from "@/shared/i18n";

/** Locale-aware admin date formatting. Pass the route lang; never rely on server locale. */
export const formatAdminDate = (value: string | Date, lang: Locale): string =>
  new Date(value).toLocaleDateString(bcp47TagFor(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** Locale-aware admin timestamp formatting for job progress and audit times. */
export const formatAdminDateTime = (value: string | Date, lang: Locale): string =>
  new Date(value).toLocaleString(bcp47TagFor(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
