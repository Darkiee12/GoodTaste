import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loadRegionServer = () =>
  Promise.all([
    import("effect"),
    import("@tanstack/react-start/server"),
    import("@/server/geo/trusted-region"),
    import("@/server/config"),
    import("@/server/runtime"),
  ]);

export interface InitialLocaleRedirect {
  /** Redirect target preserving path and params, or null when no redirect. */
  readonly href: string | null;
}

/** Localhost/dev override parsed at the I/O boundary, never trusted as proof. */
const devCountrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .optional();

const readDevCountry = (): string | undefined =>
  devCountrySchema.parse(process.env.DEV_VISITOR_COUNTRY);

/**
 * Trusted visitor country for the quiz's "where are we eating" step and for
 * first-visit locale suggestions. Cloudflare headers are only honored behind
 * a trusted proxy/CDN; locally only DEV_VISITOR_COUNTRY applies, otherwise
 * the answer is an honest null and the UI falls back to manual choice.
 */
export const getQuizRegionFn = createServerFn({ method: "GET" }).handler(async () => {
  const [effects, server, trusted, configModule, runtime] = await loadRegionServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return runtime.runApp(
    effects.Effect.flatMap(configModule.appConfig, (config) =>
      effects.Effect.sync(() => {
        const region = trusted.getTrustedVisitorCountry(
          headers,
          config.trustedProxies,
          readDevCountry(),
        );

        return { country: region.country, source: region.source };
      }),
    ),
    "fn/quiz/region",
    15000,
    requestId,
  );
});

/**
 * Server-side initial-locale resolution for the root layout: saved
 * preference first, then trusted geography, then the browser's accepted
 * languages, then English. Returns the redirect target (full path and other
 * params preserved) or null when no redirect is needed. An explicit `?lang`
 * in the request URL wins — the server never overrides it. All
 * server-module access stays inside this handler (dynamic imports only),
 * so route code never touches `@tanstack/react-start/server` and the
 * client bundle stays clean.
 */
export const resolveInitialLocaleFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<InitialLocaleRedirect> => {
    const [effects, server, trusted, configModule, runtime] = await loadRegionServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();
    const url = server.getRequestUrl();

    if (url.searchParams.has("lang")) {
      return { href: null };
    }

    const resolved = await runtime.runApp(
      effects.Effect.flatMap(configModule.appConfig, (config) =>
        effects.Effect.sync(() => {
          const region = trusted.getTrustedVisitorCountry(
            headers,
            config.trustedProxies,
            readDevCountry(),
          );

          return trusted.resolveInitialLocale({
            acceptLanguage: headers.get("accept-language"),
            cookieHeader: headers.get("cookie"),
            trustedCountry: region.country,
          });
        }),
      ),
      "fn/quiz/initial-locale",
      15000,
      requestId,
    );

    if (resolved.locale === "en") {
      return { href: null };
    }

    const target = new URL(url);
    target.searchParams.set("lang", resolved.locale);

    return { href: `${target.pathname}${target.search}` };
  },
);
