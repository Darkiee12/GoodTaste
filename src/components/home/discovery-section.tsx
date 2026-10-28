import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import { listCategoriesFn, searchDishesFn } from "@/modules/food-discovery/food.functions";
import { SaveDishButton } from "@/modules/user/components/save-dish-button";
import type { Locale, Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const PAGE_SIZE = 24;

/**
 * Homepage discovery: real published catalog dishes only — no editorial
 * fixtures, no invented availability. Every card links to its dish detail
 * page, so the globe preview is never a dead end. Category chips come from
 * the catalog taxonomy, never a hardcoded mapping.
 */
export function DiscoverySection({ copy, lang }: { copy: Messages; lang: Locale }) {
  const { session } = rootRoute.useRouteContext();
  const [category, setCategory] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: () => listCategoriesFn(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const dishes = useQuery({
    queryKey: ["catalog", "homepage-dishes", lang, category],
    queryFn: () => {
      if (category === null) {
        return searchDishesFn({ data: { locale: lang, limit: PAGE_SIZE } });
      }

      return searchDishesFn({
        data: { locale: lang, limit: PAGE_SIZE, category: [category], category_mode: "any" },
      });
    },
    staleTime: 60_000,
    retry: 1,
  });

  const options = categories.data ?? [];

  return (
    <section
      id="discover"
      aria-labelledby="discover-heading"
      className="scroll-mt-18 bg-cream px-5 py-16 sm:px-8"
    >
      <div className="mx-auto max-w-6xl">
        <h2
          id="discover-heading"
          className="font-display mb-3 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] tracking-[0.015em] text-balance"
        >
          {copy.discoverHeading}
        </h2>

        <p className="mb-6 max-w-[60ch] text-lg text-muted">{copy.discoverIntro}</p>

        {categories.isError ? (
          <p role="alert" className="mb-4 text-sm font-bold text-danger">
            Could not load dish categories — showing everything.
          </p>
        ) : null}

        <fieldset className="mb-8 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{copy.discoverHeading}</legend>

          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => {
              setCategory(null);
            }}
            className="min-h-11 cursor-pointer rounded-full border-2 border-border-soft bg-white px-4 text-sm font-bold text-ink hover:border-food-orange aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
          >
            {copy.discoverAll}
          </button>

          {options.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              aria-pressed={category === entry.slug}
              onClick={() => {
                setCategory(category === entry.slug ? null : entry.slug);
              }}
              className="min-h-11 cursor-pointer rounded-full border-2 border-border-soft bg-white px-4 text-sm font-bold text-ink hover:border-food-orange aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
            >
              {entry.displayName ?? entry.slug}
            </button>
          ))}
        </fieldset>

        {dishes.isPending ? (
          <output className="block text-base font-semibold text-muted">Loading dishes…</output>
        ) : null}

        {dishes.isError ? (
          <p
            role="alert"
            className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
          >
            Could not load dishes from the catalog.
          </p>
        ) : null}

        {dishes.data !== undefined && dishes.data.items.length === 0 ? (
          <p className="text-base text-muted">No dishes in the public catalog yet.</p>
        ) : null}

        {dishes.data !== undefined && dishes.data.items.length > 0 ? (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {dishes.data.items.map((dish) => {
              const title = dish.name ?? dish.englishName ?? dish.slug;

              const showEnglish =
                dish.name !== undefined &&
                dish.englishName !== undefined &&
                dish.name !== dish.englishName;

              return (
                <li key={dish.id}>
                  <article className="flex h-full flex-col gap-2 rounded-2xl border border-border-soft bg-white p-6 transition hover:-translate-y-0.5 hover:border-food-orange hover:shadow-[0_12px_28px_rgba(194,65,12,0.12)]">
                    <h3 className="text-lg leading-tight font-extrabold">
                      <Link
                        to="/dishes/$dishId"
                        params={{ dishId: dish.slug }}
                        search={{ lang }}
                        className="underline decoration-food-orange/60 underline-offset-4 hover:text-food-orange-strong"
                      >
                        {title}
                      </Link>
                    </h3>

                    {showEnglish ? (
                      <p className="text-sm font-semibold text-food-orange-strong">
                        {dish.englishName}
                      </p>
                    ) : null}

                    {[...dish.regionNames, ...dish.categorySlugs].length > 0 ? (
                      <ul className="flex flex-wrap gap-2" aria-label={title}>
                        {[...dish.regionNames, ...dish.categorySlugs].map((chip) => (
                          <li
                            key={chip}
                            className="rounded-full border border-border-soft bg-cream px-3 py-1 text-xs font-bold text-muted"
                          >
                            {chip}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                      <Link
                        to="/dishes/$dishId"
                        params={{ dishId: dish.slug }}
                        search={{ lang }}
                        className="inline-flex min-h-11 items-center text-sm font-bold text-brand-blue-hover underline underline-offset-4"
                      >
                        View dish
                      </Link>
                      <SaveDishButton dishId={dish.id} lang={lang} returnTo="/" session={session} />
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
