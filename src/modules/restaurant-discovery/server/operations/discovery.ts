import { Data, Effect } from "effect";

import { DishService, getPublishedDishIdentities } from "@/modules/food-discovery/server/index";
import { restaurantSearchSchema } from "@/modules/restaurant-discovery/restaurant.schema";
import type { RestaurantSearch } from "@/modules/restaurant-discovery/restaurant.schema";
import { FxRates, FxUnavailable } from "@/modules/restaurant-discovery/server/operations/fx";
import areas from "@/modules/restaurant-discovery/server/repository/sql/areas.sql";
import comparisons from "@/modules/restaurant-discovery/server/repository/sql/comparisons.sql";
import currencies from "@/modules/restaurant-discovery/server/repository/sql/dish-price-currencies.sql";
import localRanges from "@/modules/restaurant-discovery/server/repository/sql/local-price-ranges.sql";
import menuDishCandidates from "@/modules/restaurant-discovery/server/repository/sql/menu-dish-candidates.sql";
import menu from "@/modules/restaurant-discovery/server/repository/sql/menu.sql";
import searchArea from "@/modules/restaurant-discovery/server/repository/sql/search-area.sql";
import searchDish from "@/modules/restaurant-discovery/server/repository/sql/search-dish.sql";
import searchName from "@/modules/restaurant-discovery/server/repository/sql/search-name.sql";
import venue from "@/modules/restaurant-discovery/server/repository/sql/venue-detail.sql";
import { runQuery } from "@/server/database/query";
import type { ExchangeRate } from "@/shared/money";

export class RestaurantNotFound extends Data.TaggedError("RestaurantNotFound")<{}> {}

export class RestaurantInputError extends Data.TaggedError("RestaurantInputError")<{
  readonly reason: string;
}> {}

export type Venue = (typeof venue)["~reylo"]["element"];

export type MenuOffering = (typeof menu)["~reylo"]["element"];

export type RestaurantResult = (typeof searchArea)["~reylo"]["element"];

export type DishRestaurantResult = (typeof searchDish)["~reylo"]["element"];

const locationParameters = (input: RestaurantSearch) => ({
  area: input.area,
  cuisine: input.cuisine,
  longitude: input.longitude ?? null,
  latitude: input.latitude ?? null,
  radius: input.radius,
  west: input.west ?? null,
  south: input.south ?? null,
  east: input.east ?? null,
  north: input.north ?? null,
});

export const listRestaurantAreas = runQuery("restaurants/areas", (sql) => areas.run(sql));

export const getRestaurant = Effect.fn("restaurants.getRestaurant")(function* (
  venueId: string,
  channel: RestaurantSearch["channel"],
) {
  const detail = yield* runQuery("restaurants/detail", (sql) => venue.run(sql, { id: venueId }));

  if (detail === null) return yield* new RestaurantNotFound();

  const candidates = yield* runQuery("restaurants/menu-dish-candidates", (sql) =>
    menuDishCandidates.run(sql, { id: venueId }),
  );

  const published = yield* getPublishedDishIdentities(
    candidates.flatMap((row) => (row.dish_id === null ? [] : [row.dish_id])),
  );

  const offerings = yield* runQuery("restaurants/menu", (sql) =>
    menu.run(sql, {
      id: venueId,
      channel,
      published_dish_ids: published.map((dish) => BigInt(dish.id)),
    }),
  );

  return {
    venue: detail,
    offerings,
  };
});

export const searchRestaurants = Effect.fn("restaurants.searchRestaurants")(function* (
  request: RestaurantSearch,
) {
  const parsed = restaurantSearchSchema.safeParse(request);

  if (!parsed.success)
    return yield* new RestaurantInputError({
      reason: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  const input = parsed.data;
  const location = locationParameters(input);

  if (input.dish === undefined) {
    const items =
      input.q.length === 0
        ? yield* runQuery("restaurants/area-search", (sql) =>
            searchArea.run(sql, { ...location, limit: input.limit }),
          )
        : yield* runQuery("restaurants/name-search", (sql) =>
            searchName.run(sql, {
              ...location,
              q: input.q,
              sort: input.sort,
              limit: input.limit,
            }),
          );

    return { items, dishItems: [], dish: null, portions: [], ranges: [], comparisonRates: [] };
  }

  const dishes = yield* DishService;
  const dish = yield* dishes.getDish(input.dish, "en");

  const portionRows = yield* runQuery("restaurants/portions", (sql) =>
    comparisons.run(sql, { dish: BigInt(dish.id) }),
  );

  const offeringParams = {
    q: input.q,
    ...location,
    dish: BigInt(dish.id),
    channel: input.channel,
    portion: input.portion ?? null,
  };

  const ranges =
    input.area !== "" && input.portion !== undefined
      ? yield* runQuery("restaurants/local-price-range", (sql) =>
          localRanges.run(sql, { ...offeringParams, minimum_venues: 3 }),
        )
      : [];

  const comparisonRates: Array<ExchangeRate> = [];
  const rateCurrencies: Array<string> = [];
  const rateValues: Array<string> = [];

  if (input.sort.startsWith("price_") || input.budget !== undefined) {
    const quote = input.currency;

    if (quote === undefined)
      return yield* new RestaurantInputError({ reason: "Comparison currency is required" });

    const originals = yield* runQuery("restaurants/price-currencies", (sql) =>
      currencies.run(sql, offeringParams),
    );

    if (originals.length > 12)
      return yield* new RestaurantInputError({
        reason: "Choose a smaller area for currency comparison",
      });
    const fx = yield* FxRates;

    // One fixed rate per pair for all qualifying offerings, before the price query executes.
    // The quote currency converts at exactly one; every other pair resolves concurrently.
    const bases = [
      ...new Set(
        originals.flatMap((original) => (original.currency === null ? [] : [original.currency])),
      ),
    ];

    for (const base of bases) {
      if (base === quote) {
        rateCurrencies.push(base);
        rateValues.push("1");
      }
    }

    const rates = yield* Effect.forEach(
      bases.filter((base) => base !== quote),
      (base) =>
        fx.rate(base, quote).pipe(
          Effect.mapError((error) => {
            if (error instanceof FxUnavailable)
              return new FxUnavailable({
                reason:
                  "Budget or price sorting needs a current exchange rate. Retry or select the menu currency.",
              });

            return error;
          }),
          Effect.map((rate) => ({ base, value: rate.rate, rate })),
        ),
      { concurrency: 4 },
    );

    for (const entry of rates) {
      rateCurrencies.push(entry.base);
      rateValues.push(entry.value);
      comparisonRates.push(entry.rate);
    }
  }

  const dishItems = yield* runQuery("restaurants/dish-search", (sql) =>
    searchDish.run(sql, {
      ...offeringParams,
      q: input.q,
      sort: input.sort,
      budget: input.budget ?? null,
      currencies: rateCurrencies,
      rates: rateValues,
      limit: input.limit,
    }),
  );

  return {
    items: [],
    dishItems,
    dish: { id: dish.id, slug: dish.slug, name: dish.name },
    portions: portionRows,
    ranges,
    comparisonRates,
  };
});
