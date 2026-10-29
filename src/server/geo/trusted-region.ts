import { displayLocales, type Locale } from "@/shared/i18n";

/**
 * Trusted visitor-region resolution for quiz geography and first-visit
 * locale suggestions. Cloudflare `cf-*` headers are only honored behind a
 * trusted proxy/CDN (TRUSTED_PROXIES non-empty): on localhost or any direct
 * deployment the headers are client-spoofable and must never count as
 * proof — only an explicit DEV_VISITOR_COUNTRY override applies there.
 */

export type QuizRegionSource = "cdn" | "dev" | "none";

export interface TrustedQuizRegion {
  readonly country: string | null;
  readonly source: QuizRegionSource;
}

const ISO_COUNTRY_PATTERN = /^[A-Z]{2}$/;

const normalizeCountry = (raw: string | null): string | null => {
  if (raw === null) {
    return null;
  }

  const upper = raw.trim().toUpperCase();

  if (!ISO_COUNTRY_PATTERN.test(upper) || upper === "XX") {
    return null;
  }

  return upper;
};

/**
 * Resolve the visitor's coarse country from request headers. Pure and
 * side-effect free so the trust boundary is unit-testable without a server.
 */
export function getTrustedVisitorCountry(
  headers: Headers,
  trustedProxies: ReadonlyArray<string>,
  devCountry?: string,
): TrustedQuizRegion {
  if (trustedProxies.length > 0) {
    const country = normalizeCountry(headers.get("cf-ipcountry"));

    return { country, source: "cdn" };
  }

  return { country: normalizeCountry(devCountry ?? null), source: "dev" };
}

/**
 * First-visit locale suggestion from a visitor country. Only fully
 * translated UI locales are ever suggested — partial hi/es/zh always fall
 * through to English, never auto-selected.
 */
const COUNTRY_LOCALE_MAP: ReadonlyMap<string, Locale> = new Map<string, Locale>([["VN", "vi"]]);

export function suggestedLocaleForCountry(country: string | null): Locale | null {
  if (country === null) {
    return null;
  }

  return COUNTRY_LOCALE_MAP.get(country) ?? null;
}

/** Parse an Accept-Language header into primary tags in preference order. */
export function parseAcceptLanguage(header: string | null): Array<string> {
  if (header === null || header.trim() === "") {
    return [];
  }

  return header
    .split(",")
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((tag) => tag.length > 0);
}

/** First supported UI locale from browser tags; English needs no redirect. */
export function localeFromBrowserTags(tags: ReadonlyArray<string>): Locale | null {
  for (const tag of tags) {
    const primary = tag.split("-")[0]?.toLowerCase() ?? "";
    const match = displayLocales.find((locale) => locale === primary);

    if (match !== undefined && match !== "en") {
      return match;
    }
  }

  return null;
}

const LOCALE_COOKIE_PATTERN = /(?:^|;\s*)feastjourney\.lang=([^;]*)/;

export function localeFromCookieHeader(cookieHeader: string | null): Locale | null {
  if (cookieHeader === null) {
    return null;
  }

  const match = LOCALE_COOKIE_PATTERN.exec(cookieHeader);
  const value = match?.[1]?.trim() ?? "";

  const found = displayLocales.find((locale) => locale === value);

  return found ?? null;
}

export type InitialLocaleSource = "saved" | "geo" | "browser" | "default";

export interface InitialLocale {
  readonly locale: Locale;
  readonly source: InitialLocaleSource;
}

/**
 * Server-side initial-locale precedence: saved/account preference (cookie
 * written by the language menu and account settings) wins, then the
 * first-visit trusted geographic suggestion, then the browser's accepted
 * languages, then English. Explicit `?lang` is handled before this runs —
 * this function never overrides it.
 */
export function resolveInitialLocale(input: {
  readonly cookieHeader: string | null;
  readonly acceptLanguage: string | null;
  readonly trustedCountry: string | null;
}): InitialLocale {
  const saved = localeFromCookieHeader(input.cookieHeader);

  if (saved !== null) {
    return { locale: saved, source: "saved" };
  }

  const geo = suggestedLocaleForCountry(input.trustedCountry);

  if (geo !== null) {
    return { locale: geo, source: "geo" };
  }

  const browser = localeFromBrowserTags(parseAcceptLanguage(input.acceptLanguage));

  if (browser !== null) {
    return { locale: browser, source: "browser" };
  }

  return { locale: "en", source: "default" };
}
