import { Link, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import {
  CurrencySelector,
  ObservedPrice,
  useExchangeRates,
  usePreferredCurrency,
} from "@/modules/restaurant-discovery/components/currency-tools";
import { RestaurantMapPanel } from "@/modules/restaurant-discovery/components/restaurant-map-panel";
import { channelSchema } from "@/modules/restaurant-discovery/restaurant.schema";
import type { MenuOffering } from "@/modules/restaurant-discovery/server/index";
import type { Locale } from "@/shared/i18n";
import type { ExchangeRate } from "@/shared/money";

const route = getRouteApi("/restaurants/$venueId");

function MenuItem({
  offerings,
  lang,
  rates,
  initialVariant,
}: {
  offerings: ReadonlyArray<MenuOffering>;
  lang: Locale;
  rates: ReadonlyMap<string, ExchangeRate>;
  initialVariant?: string;
}) {
  const first =
    offerings.find((offering) => offering.variant_id === initialVariant) ?? offerings[0];

  const [selectedId, setSelectedId] = useState(first?.variant_id);
  const selected = offerings.find((offering) => offering.variant_id === selectedId);

  if (selected === undefined) return null;

  return (
    <article className="discovery-card">
      <p className="discovery-eyebrow">{selected.menu_name}</p>
      <h3>{selected.item_name}</h3>
      {selected.description !== "" && <p>{selected.description}</p>}
      {offerings.length > 1 ? (
        <div>
          <label htmlFor={`variant-${selected.item_id}`}>Portion / configuration</label>
          <select
            id={`variant-${selected.item_id}`}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {offerings.map((variant) => (
              <option key={variant.variant_id} value={variant.variant_id}>
                {variant.variant_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm">{selected.variant_name}</p>
      )}
      {selected.amount !== null && selected.currency !== null ? (
        <ObservedPrice
          amount={selected.amount}
          currency={selected.currency}
          locale={lang}
          rate={rates.get(selected.currency)}
        />
      ) : (
        <p className="text-muted">Price unavailable for this channel.</p>
      )}
      {selected.observed_at !== null && (
        <div className="text-xs text-muted">
          <p>
            {selected.price_kind === "paid_unit"
              ? "Historical paid unit observation"
              : "Listed menu price"}{" "}
            · {selected.sales_channel?.replace("_", " ")} · tax {selected.tax_treatment}
          </p>
          <p>
            Observed {selected.observed_at.slice(0, 10)} ·{" "}
            {selected.source_category?.replaceAll("_", " ")}
            {selected.current_enough === false && " · stale; request an updated price"}
          </p>
          {selected.source_url !== null && (
            <a href={selected.source_url} target="_blank" rel="noreferrer">
              View price source
            </a>
          )}
        </div>
      )}
      {selected.dish_id !== null && (
        <Link to="/dishes/$slug" params={{ slug: selected.dish_id }} search={{ lang }}>
          Explore this dish · {selected.match_kind} match
        </Link>
      )}
    </article>
  );
}

export function RestaurantDetailPage() {
  const { venue, offerings } = route.useLoaderData();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const preference = usePreferredCurrency();

  const conversion = useExchangeRates(
    offerings.flatMap((offering) => (offering.currency === null ? [] : [offering.currency])),
    preference.currency,
  );

  const grouped = new Map<string, Array<MenuOffering>>();

  for (const offering of offerings) {
    const existing = grouped.get(offering.item_id);

    if (existing === undefined) grouped.set(offering.item_id, [offering]);
    else existing.push(offering);
  }

  return (
    <article className="discovery-page">
      <nav aria-label="Discover">
        <Link to="/restaurants" search={{ lang: search.lang }}>
          Find restaurants
        </Link>
        <Link to="/dishes" search={{ lang: search.lang }}>
          Explore dishes
        </Link>
      </nav>
      <header>
        <p className="discovery-eyebrow">
          {venue.business_name} · {venue.area}
        </p>
        <h1>{venue.name}</h1>
        <p>{venue.address}</p>
        <a
          className="discovery-action"
          href={`https://www.google.com/maps/dir/?api=1&destination=${venue.latitude},${venue.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Get directions ↗
        </a>
      </header>
      <CurrencySelector preference={preference} />
      <div className="restaurant-detail-layout">
        <section aria-labelledby="menu-heading">
          <h2 id="menu-heading">Explore the menu</h2>
          <div className="my-4">
            <label htmlFor="menu-channel">Sales channel</label>
            <select
              id="menu-channel"
              value={search.channel}
              onChange={(event) => {
                const channel = channelSchema.parse(event.target.value);
                void navigate({ search: { ...search, channel } });
              }}
            >
              <option value="dine_in">Dine-in</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>
          <p className="mb-4 text-sm text-muted">
            These are reviewed observations, not live availability. Confirm current prices, taxes,
            service charges and dietary requirements with the venue.
          </p>
          {conversion.unavailable && (
            <p aria-live="polite">
              Approximate conversion is unavailable. Original menu prices remain available.
            </p>
          )}
          {offerings.length === 0 && (
            <div className="discovery-empty" aria-live="polite">
              No curated menu offerings have been recorded for this branch yet.
            </div>
          )}
          <div className="grid gap-4">
            {[...grouped].map(([id, variants]) => (
              <MenuItem
                key={`${id}:${search.channel}:${search.variant ?? ""}`}
                offerings={variants}
                lang={search.lang}
                rates={conversion.rates}
                initialVariant={search.variant}
              />
            ))}
          </div>
        </section>
        <aside>
          <h2>Find this branch</h2>
          <RestaurantMapPanel
            points={[{ ...venue, distance_meters: null }]}
            selected={venue.id}
            onSelect={() => {}}
            lang={search.lang}
          />
          <p className="mt-3 text-sm">{venue.address}</p>
        </aside>
      </div>
    </article>
  );
}
