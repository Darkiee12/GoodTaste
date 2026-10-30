import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { searchDishesFn } from "@/modules/food-discovery/food.functions";
import type {
  searchRestaurantsFn,
  restaurantFacetsFn,
} from "@/modules/restaurant-discovery/restaurant.functions";
import type { RestaurantSearch } from "@/modules/restaurant-discovery/restaurant.schema";

export function RestaurantFilters({
  search,
  areas,
  cuisines,
  results,
  onSubmit,
  nearMe,
  locationBusy,
  onClearLocation,
}: {
  search: RestaurantSearch;
  areas: ReadonlyArray<{ area: string }>;
  cuisines: Awaited<ReturnType<typeof restaurantFacetsFn>>;
  results: Awaited<ReturnType<typeof searchRestaurantsFn>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  nearMe: () => void;
  locationBusy: boolean;
  onClearLocation: () => void;
}) {
  const [dishQuery, setDishQuery] = useState("");

  const [selectedDish, setSelectedDish] = useState({
    id: search.dish ?? "",
    name: results.dish?.name ?? results.dish?.slug ?? "",
  });

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(dishQuery), 300);

    return () => clearTimeout(timer);
  }, [dishQuery]);

  const dishes = useQuery({
    queryKey: ["restaurant-dish-picker", debounced],
    queryFn: () => searchDishesFn({ data: { q: debounced, limit: 30 } }),
    staleTime: 60000,
  });

  return (
    <form className="restaurant-filters" onSubmit={onSubmit}>
      <div>
        <label htmlFor="restaurant-query">Restaurant name</label>
        <input
          id="restaurant-query"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={search.q}
        />
      </div>
      <div>
        <label htmlFor="restaurant-area">Area</label>
        <select id="restaurant-area" name="area" defaultValue={search.area}>
          <option value="">All recorded areas</option>
          {areas.map(({ area }) => (
            <option key={area}>{area}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="restaurant-cuisine">Cuisine</label>
        <select id="restaurant-cuisine" name="cuisine" defaultValue={search.cuisine}>
          <option value="">All cuisines</option>
          {cuisines.map((cuisine) => (
            <option key={cuisine.id} value={cuisine.slug}>
              {cuisine.displayName ?? cuisine.slug}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="dish-filter-search">Search dish choices</label>
        <input
          id="dish-filter-search"
          type="search"
          value={dishQuery}
          onChange={(event) => setDishQuery(event.target.value)}
          maxLength={100}
        />
        <label htmlFor="restaurant-dish">Dish</label>
        <select
          id="restaurant-dish"
          name="dish"
          value={selectedDish.id}
          onChange={(event) => {
            const option = event.currentTarget.selectedOptions.item(0);

            if (option !== null) setSelectedDish({ id: option.value, name: option.label });
          }}
        >
          <option value="">Any dish</option>
          {selectedDish.id !== "" &&
            !dishes.data?.items.some((dish) => dish.id === selectedDish.id) && (
              <option value={selectedDish.id}>{selectedDish.name}</option>
            )}
          {dishes.data?.items.map((dish) => (
            <option key={dish.id} value={dish.id}>
              {dish.name ?? dish.englishName ?? dish.slug}
            </option>
          ))}
        </select>
        {dishes.isError && (
          <small aria-live="polite">
            Dish choices could not load. Your selected dish is preserved.
          </small>
        )}
      </div>
      <div>
        <label htmlFor="restaurant-channel">Sales channel</label>
        <select id="restaurant-channel" name="channel" defaultValue={search.channel}>
          <option value="dine_in">Dine-in</option>
          <option value="takeaway">Takeaway</option>
          <option value="delivery">Delivery food price</option>
        </select>
      </div>
      <div>
        <label htmlFor="restaurant-portion">Comparable portion</label>
        <select id="restaurant-portion" name="portion" defaultValue={search.portion ?? ""}>
          <option value="">Choose after selecting a dish</option>
          {results.portions.map((portion) => (
            <option key={portion.comparison_key} value={portion.comparison_key ?? ""}>
              {portion.comparison_key?.replaceAll("-", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="restaurant-budget">Food price under (strict)</label>
        <input
          id="restaurant-budget"
          name="budget"
          inputMode="decimal"
          pattern="[0-9]+([.][0-9]+)?"
          defaultValue={search.budget ?? ""}
          aria-describedby="budget-help"
        />
      </div>
      <div>
        <label htmlFor="budget-currency">Budget / sorting currency</label>
        <input
          id="budget-currency"
          name="currency"
          list="budget-currencies"
          maxLength={3}
          pattern="[A-Z]{3}"
          defaultValue={search.currency ?? ""}
          placeholder="ISO code, e.g. USD"
        />
      </div>
      <div>
        <label htmlFor="restaurant-sort">Sort</label>
        <select id="restaurant-sort" name="sort" defaultValue={search.sort}>
          <option value="recommended">Recommended / relevance</option>
          <option value="nearest" disabled={search.longitude === undefined}>
            Nearest
          </option>
          <option value="price_low" disabled={search.dish === undefined}>
            Lowest known comparable price
          </option>
          <option value="price_high" disabled={search.dish === undefined}>
            Highest known comparable price
          </option>
        </select>
      </div>
      <div>
        <label htmlFor="restaurant-radius">Near Me radius</label>
        <select id="restaurant-radius" name="radius" defaultValue={search.radius}>
          <option value={1000}>1 km</option>
          <option value={5000}>5 km</option>
          <option value={10000}>10 km</option>
          <option value={25000}>25 km</option>
          <option value={50000}>50 km</option>
        </select>
      </div>
      <p id="budget-help" className="filter-help">
        Price comparison requires a dish, matching portion, channel and currency. Unknown and stale
        prices do not qualify. Taxes and additional fees may vary.
      </p>
      <div className="filter-actions">
        <button type="submit">Find restaurants</button>
        <button type="button" className="secondary" onClick={nearMe} disabled={locationBusy}>
          {locationBusy ? "Requesting location…" : "Near Me"}
        </button>
        {search.longitude !== undefined && (
          <button type="button" className="secondary" onClick={onClearLocation}>
            Clear my location
          </button>
        )}
      </div>
    </form>
  );
}
