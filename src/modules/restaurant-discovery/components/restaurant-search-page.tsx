import { Link, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  CurrencySelector,
  ObservedPrice,
  useExchangeRates,
  usePreferredCurrency,
} from "@/modules/restaurant-discovery/components/currency-tools";
import { RestaurantFilters } from "@/modules/restaurant-discovery/components/restaurant-filters";
import type { MapBounds } from "@/modules/restaurant-discovery/components/restaurant-map";
import { RestaurantMapPanel } from "@/modules/restaurant-discovery/components/restaurant-map-panel";
import { restaurantSearchSchema } from "@/modules/restaurant-discovery/restaurant.schema";
import type {
  RestaurantResult,
  DishRestaurantResult,
} from "@/modules/restaurant-discovery/server/index";
import { formatMoney } from "@/shared/money";

const route = getRouteApi("/restaurants/");

export function RestaurantSearchPage() {
  const data = route.useLoaderData();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const preference = usePreferredCurrency();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [message, setMessage] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);

  const rows: ReadonlyArray<RestaurantResult | DishRestaurantResult> =
    data.results.dish === null ? data.results.items : data.results.dishItems;

  const currencies = data.results.dishItems.flatMap((item) =>
    item.currency === null ? [] : [item.currency],
  );

  const conversion = useExchangeRates(currencies, preference.currency);

  const requestRates = new Map(
    data.results.comparisonRates
      .filter((rate) => rate.quote === preference.currency)
      .map((rate) => [rate.base, rate]),
  );

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());

    const parsed = restaurantSearchSchema.safeParse({
      ...search,
      ...values,
      dish: values.dish || undefined,
      budget: values.budget || undefined,
      currency: values.currency || undefined,
      portion: values.portion || undefined,
    });

    if (!parsed.success) {
      setMessage(parsed.error.issues.map((issue) => issue.message).join(". "));

      return;
    }

    setMessage("");
    void navigate({ search: { ...parsed.data, lang: search.lang } });
  };

  const nearMe = () => {
    if (!("geolocation" in navigator)) {
      setMessage("Location is unavailable in this browser. Choose an area instead.");

      return;
    }

    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationBusy(false);
        setMessage("");
        void navigate({
          search: {
            ...search,
            area: "",
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            west: undefined,
            east: undefined,
            south: undefined,
            north: undefined,
          },
        });
      },
      () => {
        setLocationBusy(false);
        setMessage("Location access was unavailable or declined. Choose an area to keep browsing.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <section className="discovery-page">
      <nav aria-label="Discover">
        <Link to="/dishes" search={{ lang: search.lang }}>
          Explore dishes
        </Link>
        <Link to="/restaurants" search={{ lang: search.lang }} aria-current="page">
          Find restaurants
        </Link>
        <Link to="/scan" search={{ lang: search.lang }}>
          Scan menu
        </Link>
      </nav>
      <header>
        <p className="discovery-eyebrow">Where should I eat?</p>
        <h1>Find your next table</h1>
        <p>
          Explore recorded restaurants and source-backed menus. Original food prices come first.
        </p>
      </header>
      <CurrencySelector preference={preference} />
      <datalist id="budget-currencies">
        {preference.codes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </datalist>
      {data.results.dish !== null && (
        <p className="discovery-selection">
          Serving <strong>{data.results.dish.name ?? data.results.dish.slug}</strong> · reviewed
          exact or variant matches
        </p>
      )}
      {/*
        Remount only when a filter-relevant field changes: the inputs below are
        uncontrolled (defaultValue), so external navigation (clear-filters link,
        dish pick, language switch) must resync them. Volatile fields such as
        map bounds or geolocation must not destroy local search input.
      */}
      <RestaurantFilters
        key={[
          search.q,
          search.area,
          search.cuisine,
          search.channel,
          search.portion ?? "",
          search.budget ?? "",
          search.currency ?? "",
          search.sort,
          search.radius,
          search.limit,
          search.lang,
          search.dish ?? "",
        ].join("|")}
        search={search}
        areas={data.areas}
        cuisines={data.cuisines}
        results={data.results}
        onSubmit={apply}
        nearMe={nearMe}
        locationBusy={locationBusy}
        onClearLocation={() =>
          void navigate({
            search: { ...search, longitude: undefined, latitude: undefined, sort: "recommended" },
          })
        }
      />
      {message !== "" && (
        <p role="alert" className="discovery-message">
          {message}
        </p>
      )}
      {data.results.ranges.map((range) => (
        <p key={range.currency} className="discovery-selection">
          Observed {search.channel.replace("_", " ")} food prices in {search.area}:{" "}
          <strong>
            {formatMoney(range.minimum, range.currency, search.lang)}–
            {formatMoney(range.maximum, range.currency, search.lang)}
          </strong>{" "}
          · based on {range.venue_count} venues · {search.portion} · tax included
        </p>
      ))}
      <div className="discovery-results-toolbar">
        <p aria-live="polite">
          {rows.length} recorded venues
          {rows.length === search.limit && " · result limit reached; narrow the area"}
        </p>
        <div className="mobile-map-toggle" aria-label="Results view">
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
            Map
          </button>
        </div>
      </div>
      {conversion.unavailable && (
        <p aria-live="polite" className="text-sm text-muted">
          Approximate conversion is unavailable. Original prices are shown.
        </p>
      )}
      <div className="restaurant-results" data-mobile-view={view}>
        <div className="restaurant-result-list">
          {rows.length === 0 && (
            <div className="discovery-empty" aria-live="polite">
              <h2>No qualifying restaurants yet</h2>
              <p>
                Try a wider area or another dish. A strict budget includes only known, current
                comparable prices.
              </p>
              <Link to="/restaurants" search={{ lang: search.lang }}>
                Clear filters
              </Link>
            </div>
          )}
          <ol>
            {rows.map((venue, index) => (
              <li key={venue.id} className="discovery-card" data-selected={selected === venue.id}>
                <p className="discovery-eyebrow">
                  {index + 1} · {venue.area}
                  {venue.distance_meters !== null &&
                    ` · ${(venue.distance_meters / 1000).toFixed(1)} km away`}
                </p>
                <h2>
                  <Link
                    to="/restaurants/$venueId"
                    params={{ venueId: venue.id }}
                    search={{
                      lang: search.lang,
                      channel: search.channel,
                      variant: "variant_id" in venue ? venue.variant_id : undefined,
                    }}
                  >
                    {venue.name}
                  </Link>
                </h2>
                <p>{venue.address}</p>
                {"item_name" in venue && (
                  <div className="restaurant-offering">
                    <h3>
                      {venue.item_name} · {venue.variant_name}
                    </h3>
                    {venue.amount !== null && venue.currency !== null ? (
                      <ObservedPrice
                        amount={venue.amount}
                        currency={venue.currency}
                        locale={search.lang}
                        rate={
                          requestRates.get(venue.currency) ?? conversion.rates.get(venue.currency)
                        }
                      />
                    ) : (
                      <p>Price unavailable</p>
                    )}
                    <p className="text-xs text-muted">
                      {venue.match_kind} match · evidence observed{" "}
                      {venue.evidence_observed_at.slice(0, 10)}
                    </p>
                    {venue.observed_at !== null && (
                      <p className="text-xs text-muted">
                        {venue.price_kind === "paid_unit"
                          ? "Historical paid unit price"
                          : "Listed food price"}{" "}
                        · {search.channel.replace("_", " ")} ·{" "}
                        {venue.source_category?.replaceAll("_", " ")} ·{" "}
                        {venue.observed_at.slice(0, 10)}
                        {venue.current_enough === false && " · stale observation"} · tax{" "}
                        {venue.tax_treatment}
                      </p>
                    )}
                  </div>
                )}
                <div className="discovery-card-actions">
                  <Link
                    to="/restaurants/$venueId"
                    params={{ venueId: venue.id }}
                    search={{
                      lang: search.lang,
                      channel: search.channel,
                      variant: "variant_id" in venue ? venue.variant_id : undefined,
                    }}
                  >
                    View menu
                  </Link>
                  <button
                    type="button"
                    className="secondary"
                    aria-pressed={selected === venue.id}
                    onClick={() => {
                      setSelected(venue.id);
                      setView("map");
                    }}
                  >
                    Show on map
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="restaurant-result-map" aria-label="Restaurant map">
          {bounds !== null && (
            <button
              type="button"
              onClick={() => {
                void navigate({
                  search: {
                    ...search,
                    ...bounds,
                    area: "",
                    longitude: undefined,
                    latitude: undefined,
                    sort: search.sort === "nearest" ? "recommended" : search.sort,
                  },
                });
                setBounds(null);
              }}
            >
              Search this map area
            </button>
          )}
          <RestaurantMapPanel
            points={rows}
            selected={selected}
            onSelect={setSelected}
            onBounds={setBounds}
            lang={search.lang}
          />
        </aside>
      </div>
    </section>
  );
}
