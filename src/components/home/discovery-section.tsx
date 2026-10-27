import { useState } from "react";

import {
  FOOD_LOCATIONS,
  dishesInCategory,
  localizedDishText,
  type FoodCategory,
} from "@/components/home/globe/food-locations";
import type { Locale, Messages } from "@/shared/i18n";

/**
 * Discovery filter: "all" plus the FoodCategory TaggedEnum discriminant tags.
 * Tags (not enum instances) keep button identity and React keys on plain
 * string equality; dish matching below stays exhaustive via $match.
 */
type FilterId = FoodCategory["_tag"] | "all";

export function DiscoverySection({ copy, lang }: { copy: Messages; lang: Locale }) {
  const [filter, setFilter] = useState<FilterId>("all");

  const filters: Array<{ id: FilterId; label: string }> = [
    { id: "all", label: copy.discoverAll },
    { id: "LocalFavorites", label: copy.categoryLocalFavorites },
    { id: "StreetFood", label: copy.categoryStreetFood },
    { id: "ComfortingBowls", label: copy.categoryComfortingBowls },
    { id: "WorthTravelling", label: copy.categoryWorthTravelling },
  ];

  const dishes = filter === "all" ? FOOD_LOCATIONS : dishesInCategory(FOOD_LOCATIONS, filter);

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

        <fieldset className="mb-8 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{copy.discoverHeading}</legend>

          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => {
                setFilter(option.id);
              }}
              className="min-h-11 cursor-pointer rounded-full border-2 border-border-soft bg-white px-4 text-sm font-bold text-ink hover:border-food-orange aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {dishes.map((dish) => (
            <li key={dish.id}>
              <article className="flex h-full flex-col gap-2 rounded-2xl border border-border-soft bg-white p-6 transition hover:-translate-y-0.5 hover:border-food-orange hover:shadow-[0_12px_28px_rgba(194,65,12,0.12)]">
                <span aria-hidden="true" className="text-4xl leading-none">
                  {dish.emoji}
                </span>

                <h3 className="text-lg leading-tight font-extrabold">{dish.name}</h3>

                <p className="text-sm font-semibold text-food-orange-strong">
                  {localizedDishText(dish.country, lang)} · {localizedDishText(dish.region, lang)}
                </p>

                <p className="text-[0.95rem] text-muted">
                  {localizedDishText(dish.description, lang)}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
