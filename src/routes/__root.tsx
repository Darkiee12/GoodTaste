import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { LanguageMenu } from "@/components/language-menu";
import { authorizeFn } from "@/modules/user/admin.functions";
import { getSessionStateFn } from "@/modules/user/session.functions";
import {
  bcp47TagFor,
  detectBrowserLocale,
  hasExplicitLocaleChoice,
  localeSearchSchema,
  messagesFor,
} from "@/shared/i18n";

import stylesheet from "@/styles.css?url";

export const Route = createRootRoute({
  validateSearch: localeSearchSchema,
  search: { middlewares: [stripSearchParams({ lang: "en" })] },
  beforeLoad: async () => {
    const session = await getSessionStateFn();

    if (session.status !== "signed-in") {
      return { session, isAdmin: false as const };
    }

    const { allowed } = await authorizeFn({
      data: { checks: [{ resource: "admin", actions: ["access"] }] },
    });

    return { session, isAdmin: allowed };
  },
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: messagesFor(match.search.lang).title },
      {
        name: "description",
        content: messagesFor(match.search.lang).description,
      },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bangers&display=swap",
      },
    ],
  }),
  shellComponent: Document,
  component: AppLayout,
});

function Document({ children }: { children: ReactNode }) {
  const { lang } = Route.useSearch();

  return (
    <html lang={bcp47TagFor(lang)} className="scroll-smooth motion-reduce:scroll-auto">
      <head>
        <HeadContent />
      </head>
      <body className="bg-cream font-body text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AppLayout() {
  const { lang } = Route.useSearch();
  const { session } = Route.useRouteContext();
  const copy = messagesFor(lang);
  const navigate = useNavigate();
  const [queryClient] = useState(() => new QueryClient());

  // First visit only: default to the browser's language when it is a fully
  // translated UI locale. Manual picks are remembered and never overridden;
  // an explicit ?lang= URL wins over detection.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (hasExplicitLocaleChoice()) {
      return;
    }

    if (new URLSearchParams(window.location.search).has("lang")) {
      return;
    }

    const detected = detectBrowserLocale();

    if (detected !== null && detected !== lang) {
      void navigate({
        to: ".",
        search: (previous) => ({ ...previous, lang: detected }),
        replace: true,
      });
    }
    // Mount-only default: reacting to later changes would fight the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <a
        href="#main"
        className="fixed top-4 left-4 z-[60] -translate-y-[300%] rounded-md bg-white p-4 font-bold text-ink focus:translate-y-0"
      >
        {copy.skipContent}
      </a>

      <header className="site-header sticky top-0 z-50 border-b border-white/10 bg-space-deep">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-6">
          <Link
            to="/"
            search={{ lang }}
            aria-label={copy.homeLabel}
            className="font-display mr-auto flex items-center gap-3 text-2xl leading-none tracking-wide text-white no-underline md:text-3xl"
          >
            <img
              src="/applogo.png"
              alt=""
              width={64}
              height={64}
              fetchPriority="high"
              className="block h-8 w-auto object-contain md:h-10"
            />
            FeastJourney
          </Link>

          <nav aria-label="FeastJourney" className="flex flex-wrap items-center gap-1">
            <Link
              to="/"
              search={{ lang }}
              hash="discover"
              resetScroll={false}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white"
            >
              {copy.navDiscover}
            </Link>
            <Link
              to="/"
              search={{ lang }}
              hash="recommend"
              resetScroll={false}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white"
            >
              {copy.ctaRecommend}
            </Link>
          </nav>

          <div className="flex items-center gap-1">
            <AccountMenu />
            <LanguageMenu />
          </div>
        </div>
      </header>

      {session.status === "unavailable" ? (
        <p
          role="note"
          className="border-b border-mango/40 bg-cream px-4 py-2 text-center text-sm font-semibold text-ink"
        >
          {copy.saveDishPaused}
        </p>
      ) : null}

      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer bg-space-deep text-muted-on-dark">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-sm">
          <span>{copy.footerTagline}</span>
          <span>{copy.footerAdvice}</span>
        </div>
      </footer>
    </QueryClientProvider>
  );
}
