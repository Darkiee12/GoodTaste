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
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authorizeFn } from "@/modules/user/admin.functions";
import { signOutFn } from "@/modules/user/auth.functions";
import { getSessionStateFn } from "@/modules/user/session.functions";
import {
  bcp47TagFor,
  displayLocales,
  localeNameFor,
  localeSearchSchema,
  messagesFor,
} from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";

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

function MemberNav({ lang, isAdmin }: { lang: Locale; isAdmin: boolean }) {
  const copy = messagesFor(lang);
  const navigate = useNavigate();

  const signOut = (): void => {
    void signOutFn()
      .catch(() => undefined)
      .finally(() => {
        void navigate({ to: "/", search: { lang } });
      });
  };

  return (
    <>
      <Link
        to="/saved"
        search={{ lang }}
        activeOptions={{ exact: true }}
        activeProps={{ "aria-current": "page" }}
        className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white aria-current:bg-white/15 aria-current:text-white"
      >
        Saved
      </Link>
      <Link
        to="/settings/account"
        search={{ lang }}
        activeProps={{ "aria-current": "page" }}
        className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white aria-current:bg-white/15 aria-current:text-white"
      >
        {copy.authAccount}
      </Link>
      {isAdmin ? (
        <Link
          to="/admin"
          search={{ lang }}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-mango no-underline hover:bg-white/10 hover:text-white"
        >
          {copy.adminWorkspace}
        </Link>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white"
      >
        {copy.authSignOut}
      </button>
    </>
  );
}

function GuestNav({ lang }: { lang: Locale }) {
  const copy = messagesFor(lang);

  return (
    <>
      <Link
        to="/sign-in"
        search={{ lang, returnTo: "/" }}
        activeProps={{ "aria-current": "page" }}
        className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white aria-current:bg-white/15 aria-current:text-white"
      >
        {copy.authSignIn}
      </Link>
      <Link
        to="/sign-up"
        search={{ lang, returnTo: "/" }}
        activeProps={{ "aria-current": "page" }}
        className="inline-flex min-h-11 items-center rounded-full border border-white/25 px-4 text-sm font-bold text-white no-underline hover:border-white/50 hover:bg-white/10 aria-current:bg-white/15"
      >
        {copy.authSignUp}
      </Link>
    </>
  );
}

function AppLayout() {
  const { lang } = Route.useSearch();
  const { session, isAdmin } = Route.useRouteContext();
  const copy = messagesFor(lang);
  const [queryClient] = useState(() => new QueryClient());

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
              Discover
            </Link>
            <Link
              to="/recommend"
              search={{ lang }}
              activeProps={{ "aria-current": "page" }}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/85 no-underline hover:bg-white/10 hover:text-white aria-current:bg-white/15 aria-current:text-white"
            >
              {copy.ctaRecommend}
            </Link>
            {session.status === "signed-in" ? (
              <MemberNav lang={lang} isAdmin={isAdmin} />
            ) : (
              <GuestNav lang={lang} />
            )}
          </nav>

          <nav aria-label={copy.languageLabel}>
            {/* Non-modal: opening the menu must not lock scroll or shift the page. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-transparent px-3 text-sm font-semibold text-muted-on-dark hover:border-white/25 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
                >
                  <GlobeIcon aria-hidden="true" className="size-4" />
                  <span>{localeNameFor(lang)}</span>
                  <ChevronDownIcon aria-hidden="true" className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {displayLocales.map((locale) => {
                    const isCurrent = locale === lang;

                    return (
                      <DropdownMenuItem key={locale} asChild>
                        <Link
                          to="."
                          search={(previous) => ({ ...previous, lang: locale })}
                          hash={true}
                          resetScroll={false}
                          lang={bcp47TagFor(locale)}
                          hrefLang={bcp47TagFor(locale)}
                          activeOptions={{ exact: true }}
                          aria-current={isCurrent ? "true" : undefined}
                          className={cn(isCurrent && "font-semibold")}
                        >
                          <span>{localeNameFor(locale)}</span>
                          {isCurrent ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      {session.status === "unavailable" ? (
        <p
          role="note"
          className="border-b border-mango/40 bg-cream px-4 py-2 text-center text-sm font-semibold text-ink"
        >
          Sign-in status is unavailable — discovery still works, saving is paused.
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
