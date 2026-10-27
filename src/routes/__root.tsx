import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  stripSearchParams,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { localeNames, locales, localeSearchSchema, messages } from "../shared/i18n";

import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  validateSearch: localeSearchSchema,
  search: { middlewares: [stripSearchParams({ lang: "en" })] },
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: messages[match.search.lang].title },
      {
        name: "description",
        content: messages[match.search.lang].description,
      },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: Document,
  component: AppLayout,
});

function Document({ children }: { children: ReactNode }) {
  const { lang } = Route.useSearch();

  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AppLayout() {
  const { lang } = Route.useSearch();
  const copy = messages[lang];

  return (
    <>
      <a className="skip-link" href="#main">
        {copy.skipContent}
      </a>
      <header className="site-header">
        <Link className="wordmark" to="/" search={{ lang }} aria-label={copy.homeLabel}>
          GoodTaste<span aria-hidden="true">✳</span>
        </Link>
        <div className="header-actions">
          <span className="site-status">{copy.comingSoon}</span>
          <nav className="language-switcher" aria-label={copy.languageLabel}>
            {locales.map((locale) => (
              <Link
                key={locale}
                to="/"
                search={(previous) => ({ ...previous, lang: locale })}
                hash={true}
                resetScroll={false}
                lang={locale}
                hrefLang={locale}
                activeOptions={{ exact: true }}
              >
                {localeNames[locale]}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>{copy.footerTagline}</span>
        <span>{copy.footerAdvice}</span>
      </footer>
    </>
  );
}
