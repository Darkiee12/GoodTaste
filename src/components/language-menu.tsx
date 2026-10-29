import { getRouteApi, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  bcp47TagFor,
  displayLocales,
  localeNameFor,
  markLocaleExplicit,
  messagesFor,
} from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

/** Standalone language picker in the site header. Never navigates away: the
 * current route, hash, and other search state are preserved. A manual pick
 * is remembered so the browser-locale default never overrides it. */
export function LanguageMenu() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  return (
    <nav aria-label={copy.languageLabel}>
      {/* Non-modal: opening the menu must not lock scroll or shift the page. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={copy.languageLabel}
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
                    onClick={() => {
                      markLocaleExplicit();
                    }}
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
  );
}
