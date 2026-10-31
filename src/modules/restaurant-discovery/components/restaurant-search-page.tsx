import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ChevronUp, List, Map as MapIcon, X } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import {
  CurrencySelector,
  useExchangeRates,
  usePreferredCurrency,
} from "@/modules/restaurant-discovery/components/currency-tools";
import { RestaurantCard } from "@/modules/restaurant-discovery/components/restaurant-card";
import type { RestaurantCardModel } from "@/modules/restaurant-discovery/components/restaurant-card";
import { restaurantCopy } from "@/modules/restaurant-discovery/components/restaurant-copy";
import type { RestaurantCopy } from "@/modules/restaurant-discovery/components/restaurant-copy";
import {
  DatasetEmptyState,
  NoMatchState,
} from "@/modules/restaurant-discovery/components/restaurant-empty-states";
import { RestaurantFiltersSheet } from "@/modules/restaurant-discovery/components/restaurant-filters-sheet";
import type { MapBounds } from "@/modules/restaurant-discovery/components/restaurant-map";
import { RestaurantMapPanel } from "@/modules/restaurant-discovery/components/restaurant-map-panel";
import {
  RestaurantSearchHero,
  type SearchPick,
} from "@/modules/restaurant-discovery/components/restaurant-search-hero";
import { DEFAULT_MAP_CENTER, type MapCenter } from "@/modules/restaurant-discovery/map-bounds";
import { restaurantSearchSchema } from "@/modules/restaurant-discovery/restaurant.schema";
import type { RestaurantSearch } from "@/modules/restaurant-discovery/restaurant.schema";
import type {
  DishRestaurantResult,
  RestaurantResult,
} from "@/modules/restaurant-discovery/server/index";
import type { Locale } from "@/shared/i18n";

const route = getRouteApi("/restaurants/");

const mapAvailable = z.url().safeParse(import.meta.env.VITE_MAP_STYLE_URL).success;

const REGION_PRESETS = [
  { id: "vietnam", west: 102.0, south: 8.0, east: 110.0, north: 24.0, zoom: 5 },
  { id: "hcmc", west: 106.4, south: 10.4, east: 107.0, north: 11.1, zoom: 11 },
  { id: "hanoi", west: 105.5, south: 20.8, east: 106.1, north: 21.3, zoom: 11 },
] as const;

type RegionId = (typeof REGION_PRESETS)[number]["id"];

function boundsZoom(west: number, east: number, south: number, north: number): number {
  const span = Math.max(Math.abs(east - west), Math.abs(north - south));

  if (span > 20) return 4;

  if (span > 5) return 6;

  if (span > 1) return 9;

  if (span > 0.2) return 11;

  return 13;
}

function DishChip({
  dishName,
  dishSlug,
  lang,
  onExpandArea,
  onClearDish,
}: {
  readonly dishName: string;
  readonly dishSlug: string;
  readonly lang: Locale;
  readonly onExpandArea: () => void;
  readonly onClearDish: () => void;
}) {
  const copy = restaurantCopy(lang);

  return (
    <section aria-label={copy.servingTitle.replace("{name}", dishName)} className="res-dish-chip">
      <span className="res-chip-dot" aria-hidden="true" />
      <p className="res-chip-label">{copy.servingTitle.replace("{name}", dishName)}</p>
      <span className="res-chip-evidence">{copy.dishEvidence}</span>
      <span className="res-chip-actions">
        <Link
          to="/dishes/$dishId"
          params={{ dishId: dishSlug }}
          search={{ lang }}
          className="res-chip-link"
        >
          <ArrowLeft aria-hidden="true" />
          {copy.backToDish}
        </Link>
        <button type="button" className="res-chip-btn" onClick={onExpandArea}>
          {copy.expandArea}
        </button>
        <button
          type="button"
          className="res-chip-btn"
          onClick={onClearDish}
          aria-label={copy.clearDish}
        >
          <X aria-hidden="true" />
          {copy.clearDish}
        </button>
      </span>
    </section>
  );
}

export function RestaurantSearchPage() {
  const data = route.useLoaderData();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const preference = usePreferredCurrency();
  const copy = restaurantCopy(search.lang);
  const [selected, setSelected] = useState<string | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [message, setMessage] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [sheet, setSheet] = useState<"peek" | "expanded" | "full">("peek");
  const dragStart = useRef<{ y: number; sheet: "peek" | "expanded" | "full" } | null>(null);

  const isDishMode = data.results.dish !== null;

  const rows: ReadonlyArray<RestaurantResult | DishRestaurantResult> = isDishMode
    ? data.results.dishItems
    : data.results.items;

  const currencies = data.results.dishItems.flatMap((item) =>
    item.currency === null ? [] : [item.currency],
  );

  const conversion = useExchangeRates(currencies, preference.currency);

  const requestRates = new Map(
    data.results.comparisonRates
      .filter((rate) => rate.quote === preference.currency)
      .map((rate) => [rate.base, rate]),
  );

  const dishSlug = search.fromDish ?? data.results.dish?.slug ?? null;
  const dishName = data.results.dish?.name ?? data.results.dish?.slug ?? null;

  const hasCoords = search.longitude !== undefined || search.west !== undefined;
  const hasScope = search.area !== "" || hasCoords || search.q !== "" || search.cuisine !== "";
  const datasetEmpty = data.areas.length === 0 && rows.length === 0;

  const mapCenter: MapCenter = (() => {
    if (search.longitude !== undefined && search.latitude !== undefined) {
      return { longitude: search.longitude, latitude: search.latitude, zoom: 13 };
    }

    if (
      search.west !== undefined &&
      search.south !== undefined &&
      search.east !== undefined &&
      search.north !== undefined
    ) {
      const crossesAntimeridian = search.east < search.west;

      const longitude = crossesAntimeridian
        ? (((((search.west + search.east + 360) / 2 + 180) % 360) + 360) % 360) - 180
        : (search.west + search.east) / 2;

      return {
        longitude,
        latitude: (search.south + search.north) / 2,
        zoom: boundsZoom(search.west, search.east, search.south, search.north),
      };
    }

    return DEFAULT_MAP_CENTER;
  })();

  const regionLabel = (() => {
    if (search.longitude !== undefined) return copy.mapRegionOrigin;

    if (search.west !== undefined) return copy.mapRegionBounds;

    if (search.area !== "") return copy.mapRegionArea.replace("{area}", search.area);

    return copy.mapRegionDefault;
  })();

  const activeFilterCount =
    (search.cuisine === "" ? 0 : 1) +
    (search.channel === "dine_in" ? 0 : 1) +
    (search.portion === undefined ? 0 : 1) +
    (search.budget === undefined ? 0 : 1) +
    (search.sort === "recommended" ? 0 : 1);

  const applyPatch = (patch: Partial<RestaurantSearch>) => {
    const parsed = restaurantSearchSchema.safeParse({ ...search, ...patch });

    if (!parsed.success) {
      setMessage(parsed.error.issues.map((issue) => issue.message).join(". "));

      return;
    }

    setMessage("");
    void navigate({
      search: { ...parsed.data, lang: search.lang, fromDish: search.fromDish },
    });
  };

  const expandArea = () => {
    setMessage("");
    void navigate({
      search: {
        ...search,
        area: "",
        longitude: undefined,
        latitude: undefined,
        west: undefined,
        south: undefined,
        east: undefined,
        north: undefined,
        sort: search.sort === "nearest" ? "recommended" : search.sort,
      },
    });
  };

  const clearDish = () => {
    setMessage("");

    const nextSort =
      search.sort === "price_low" || search.sort === "price_high" ? "recommended" : search.sort;

    void navigate({
      search: {
        ...search,
        dish: undefined,
        portion: undefined,
        budget: undefined,
        currency: undefined,
        sort: nextSort,
      },
    });
  };

  const browseNearby = () => {
    setMessage("");
    clearDish();
  };

  const pickRegion = (id: RegionId) => {
    const preset = REGION_PRESETS.find((entry) => entry.id === id);

    if (preset === undefined) return;
    setMessage("");
    setBounds(null);
    void navigate({
      search: {
        ...search,
        area: "",
        longitude: undefined,
        latitude: undefined,
        west: preset.west,
        south: preset.south,
        east: preset.east,
        north: preset.north,
        sort: search.sort === "nearest" ? "recommended" : search.sort,
      },
    });
  };

  const clearAll = () => {
    setMessage("");
    void navigate({
      search: {
        ...search,
        q: "",
        area: "",
        cuisine: "",
        dish: undefined,
        portion: undefined,
        budget: undefined,
        currency: undefined,
        longitude: undefined,
        latitude: undefined,
        west: undefined,
        south: undefined,
        east: undefined,
        north: undefined,
        channel: "dine_in",
        sort: "recommended",
        radius: 5000,
      },
    });
  };

  const submitText = (text: string) => {
    if (text === "") {
      return;
    }

    applyPatch({
      q: text,
      dish: undefined,
      cuisine: undefined,
      portion: undefined,
      budget: undefined,
      currency: undefined,
    });
  };

  const applyPick = (pick: SearchPick) => {
    if (pick.kind === "dish") {
      applyPatch({
        dish: pick.id,
        q: "",
        cuisine: undefined,
        portion: undefined,
        budget: undefined,
        currency: undefined,
      });

      return;
    }

    applyPatch({
      cuisine: pick.id,
      q: "",
      dish: undefined,
      portion: undefined,
      budget: undefined,
      currency: undefined,
    });
  };

  const nearMe = () => {
    if (!("geolocation" in navigator)) {
      setMessage(copy.locationDenied);

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
        setMessage(copy.locationDenied);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const handleSelect = (id: string) => {
    setSelected(id);

    if (typeof document !== "undefined") {
      document
        .getElementById(`res-card-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  };

  const channelLabel = channelLabelFor(search.channel, copy);

  const modelFor = (venue: RestaurantResult | DishRestaurantResult): RestaurantCardModel => {
    const dish = isDishRow(venue) ? venue : null;

    return {
      id: venue.id,
      name: venue.name,
      area: venue.area,
      address: venue.address,
      distanceKm: venue.distance_meters === null ? null : (venue.distance_meters / 1000).toFixed(1),
      dish:
        dish === null
          ? null
          : {
              itemName: dish.item_name,
              variantName: dish.variant_name,
              amount: dish.amount,
              currency: dish.currency,
              matchKind: dish.match_kind,
              evidenceDate: dish.evidence_observed_at.slice(0, 10),
              stale: dish.current_enough === false,
              channelLabel,
              sourceCategory: dish.source_category,
              rate:
                requestRates.get(dish.currency ?? "") ?? conversion.rates.get(dish.currency ?? ""),
            },
      detailSearch: {
        lang: search.lang,
        channel: search.channel,
        variant: dish?.variant_id,
        dish: search.dish,
        fromDish: search.fromDish,
      },
    };
  };

  const selectedVenue = selected === null ? undefined : rows.find((venue) => venue.id === selected);

  const selectedModel = selectedVenue === undefined ? null : modelFor(selectedVenue);

  const locationText = () => {
    if (search.longitude !== undefined) {
      return `${copy.nearYou} · ${search.radius / 1000} km · `;
    }

    if (search.area !== "") {
      return `${search.area} · `;
    }

    return `${copy.showingAll} · `;
  };

  const showDishZero = isDishMode && rows.length === 0 && !datasetEmpty && data.areas.length > 0;
  const showDatasetZero = rows.length === 0 && (datasetEmpty || !hasScope);
  const showNoMatch = rows.length === 0 && hasScope && !isDishMode && !datasetEmpty;

  return (
    <div className="res-map-page">
      <RestaurantSearchHero
        key={[
          search.q,
          search.area,
          search.cuisine,
          search.lang,
          search.dish ?? "",
          search.fromDish ?? "",
        ].join("|")}
        compact
        copy={copy}
        areas={data.areas}
        cuisines={data.cuisines}
        initialText={search.q}
        initialArea={search.area}
        activeFilterCount={activeFilterCount}
        locationBusy={locationBusy}
        onSubmitText={submitText}
        onPick={applyPick}
        onAreaChange={(area) =>
          applyPatch({
            area,
            longitude: undefined,
            latitude: undefined,
            west: undefined,
            south: undefined,
            east: undefined,
            north: undefined,
            sort: search.sort === "nearest" ? "recommended" : search.sort,
          })
        }
        onNearMe={nearMe}
        onOpenFilters={() => {
          setSheetKey((key) => key + 1);
          setSheetOpen(true);
        }}
      />
      <RestaurantFiltersSheet
        key={sheetKey}
        copy={copy}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        search={search}
        cuisines={data.cuisines}
        portions={data.results.portions}
        currencyCodes={preference.codes}
        dishActive={isDishMode}
        canSortNearest={search.longitude !== undefined}
        onApply={applyPatch}
        onClear={() => {
          setSheetOpen(false);
          clearAll();
        }}
      />
      {message !== "" && (
        <p role="alert" className="res-alert">
          {message}
        </p>
      )}
      {isDishMode && dishName !== null && dishSlug !== null && (
        <DishChip
          dishName={dishName}
          dishSlug={dishSlug}
          lang={search.lang}
          onExpandArea={expandArea}
          onClearDish={clearDish}
        />
      )}
      {!mapAvailable && <output className="res-map-missing">{copy.mapConfigMissing}</output>}
      <div className="res-region-row" aria-live="polite">
        <p className="res-region-label">{regionLabel}</p>
        {!hasCoords && search.area === "" && (
          <fieldset className="res-region-picks">
            <legend className="sr-only">{copy.regionChoose}</legend>
            <button type="button" className="res-chip-btn" onClick={() => pickRegion("vietnam")}>
              {copy.regionVietnam}
            </button>
            <button type="button" className="res-chip-btn" onClick={() => pickRegion("hcmc")}>
              {copy.regionHcmc}
            </button>
            <button type="button" className="res-chip-btn" onClick={() => pickRegion("hanoi")}>
              {copy.regionHanoi}
            </button>
          </fieldset>
        )}
        <p className="res-region-hint">{copy.mapRegionHint}</p>
      </div>
      <div className="res-map-layout" data-sheet={sheet} data-map={mapAvailable ? "on" : "off"}>
        <section aria-label={copy.listView} className="res-list-pane">
          <div className="res-toolbar">
            <p aria-live="polite" className="res-count">
              {rows.length === 1 ? copy.oneRestaurant : `${rows.length} ${copy.manyRestaurants}`}
              {rows.length === search.limit &&
                ` · ${copy.resultLimit.replace("{limit}", String(search.limit))}`}
            </p>
            <div className="res-tools">
              <CurrencySelector
                preference={preference}
                equivalentsIn={copy.equivalentsIn}
                originalOnly={copy.originalOnly}
              />
              <label className="res-sort">
                <span className="sr-only">{copy.sortLabel}</span>
                <select
                  value={search.sort}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (
                      value === "recommended" ||
                      value === "nearest" ||
                      value === "price_low" ||
                      value === "price_high"
                    ) {
                      applyPatch({ sort: value });
                    }
                  }}
                >
                  <option value="recommended">{copy.sortRecommended}</option>
                  <option value="nearest" disabled={search.longitude === undefined}>
                    {copy.sortNearest}
                  </option>
                  <option value="price_low" disabled={!isDishMode}>
                    {copy.sortPriceLow}
                  </option>
                  <option value="price_high" disabled={!isDishMode}>
                    {copy.sortPriceHigh}
                  </option>
                </select>
              </label>
            </div>
          </div>
          <p className="res-location">
            {locationText()}
            {search.longitude !== undefined && (
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    search: {
                      ...search,
                      longitude: undefined,
                      latitude: undefined,
                      sort: "recommended",
                    },
                  })
                }
              >
                {copy.clearFilters}
              </button>
            )}
          </p>
          {conversion.unavailable && (
            <p aria-live="polite" className="res-note">
              {copy.priceNote}
            </p>
          )}
          {showDatasetZero && <DatasetEmptyState copy={copy} lang={search.lang} />}
          {isDishMode && datasetEmpty && (
            <p aria-live="polite" className="res-note">
              {copy.noReviewedBody}
            </p>
          )}
          {showDishZero && (
            <div className="res-empty">
              <h2>{copy.noReviewedTitle}</h2>
              <p aria-live="polite">{copy.noReviewedBody}</p>
              <div className="res-empty-actions">
                <button type="button" className="res-primary" onClick={browseNearby}>
                  {copy.browseNearby}
                </button>
                <button type="button" className="res-ghost" onClick={expandArea}>
                  {copy.expandArea}
                </button>
                <button type="button" className="res-ghost" onClick={clearAll}>
                  {copy.clearFilters}
                </button>
              </div>
            </div>
          )}
          {showNoMatch && <NoMatchState copy={copy} onClear={clearAll} />}
          {rows.length > 0 && (
            <ul className="res-list">
              {rows.map((venue) => {
                const model = modelFor(venue);

                return (
                  <li
                    key={venue.id}
                    id={`res-card-${venue.id}`}
                    data-selected={selected === venue.id}
                  >
                    <RestaurantCard
                      copy={copy}
                      model={model}
                      selected={selected === venue.id}
                      onShowOnMap={
                        mapAvailable
                          ? () => {
                              handleSelect(venue.id);
                              setSheet("peek");
                            }
                          : null
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {mapAvailable && (
          <section aria-label={copy.mapView} className="res-map-pane">
            <div
              className="res-sheet-handle"
              role="toolbar"
              aria-label={copy.mapView}
              onPointerDown={(event) => {
                dragStart.current = { y: event.clientY, sheet };

                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const start = dragStart.current;

                dragStart.current = null;

                if (start === null) return;
                const dy = event.clientY - start.y;

                if (dy < -120) {
                  setSheet("full");
                } else if (dy < -40) {
                  setSheet(start.sheet === "peek" ? "expanded" : "full");
                } else if (dy > 40) {
                  setSheet(start.sheet === "full" ? "expanded" : "peek");
                }
              }}
            >
              <span aria-hidden="true" className="res-sheet-grip" />
              <span className="res-sheet-buttons">
                <button
                  type="button"
                  className="res-chip-btn"
                  aria-expanded={sheet !== "peek"}
                  onClick={() => setSheet(sheet === "peek" ? "expanded" : "peek")}
                >
                  {sheet === "peek" ? (
                    <>
                      <ChevronUp aria-hidden="true" />
                      {copy.sheetExpand}
                    </>
                  ) : (
                    <>
                      <ChevronDown aria-hidden="true" />
                      {copy.sheetCollapse}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="res-chip-btn"
                  aria-pressed={sheet === "full"}
                  onClick={() => setSheet(sheet === "full" ? "peek" : "full")}
                >
                  {sheet === "full" ? <MapIcon aria-hidden="true" /> : <List aria-hidden="true" />}
                  {sheet === "full" ? copy.mapView : copy.sheetFullList}
                </button>
              </span>
            </div>
            {bounds !== null && (
              <button
                type="button"
                className="res-search-area"
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
                {copy.searchThisArea}
              </button>
            )}
            <div className="res-map-wrap">
              <RestaurantMapPanel
                points={rows}
                selected={selected}
                onSelect={handleSelect}
                onBounds={setBounds}
                lang={search.lang}
                center={mapCenter}
                emptyNote={isDishMode ? copy.noReviewedBody : copy.mapEmpty}
              />
              {selectedModel !== null && (
                <article className="res-preview" aria-label={selectedModel.name}>
                  <div className="res-preview-body">
                    <p className="res-card-eyebrow">
                      {selectedModel.area}
                      {selectedModel.distanceKm !== null &&
                        ` · ${copy.kmAway.replace("{km}", selectedModel.distanceKm)}`}
                    </p>
                    <h3>
                      <Link
                        to="/restaurants/$venueId"
                        params={{ venueId: selectedModel.id }}
                        search={selectedModel.detailSearch}
                      >
                        {selectedModel.name}
                      </Link>
                    </h3>
                    <p className="res-card-addr">{selectedModel.address}</p>
                    {selectedModel.dish !== null && (
                      <p className="res-match-dish">
                        {selectedModel.dish.itemName} · {selectedModel.dish.variantName}
                        {selectedModel.dish.amount !== null &&
                          selectedModel.dish.currency !== null &&
                          ` · ${selectedModel.dish.amount} ${selectedModel.dish.currency}`}
                      </p>
                    )}
                    <span className="res-preview-actions">
                      <Link
                        className="res-view"
                        to="/restaurants/$venueId"
                        params={{ venueId: selectedModel.id }}
                        search={selectedModel.detailSearch}
                      >
                        {copy.viewMenu}
                      </Link>
                      <button
                        type="button"
                        className="res-chip-btn"
                        onClick={() => setSelected(null)}
                        aria-label={copy.previewClose}
                      >
                        <X aria-hidden="true" />
                        {copy.previewClose}
                      </button>
                    </span>
                  </div>
                </article>
              )}
            </div>
            <p className="res-map-attr">{copy.mapAttributionNote}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function isDishRow(row: RestaurantResult | DishRestaurantResult): row is DishRestaurantResult {
  return "variant_id" in row;
}

function channelLabelFor(channel: RestaurantSearch["channel"], copy: RestaurantCopy): string {
  if (channel === "takeaway") {
    return copy.takeaway;
  }

  if (channel === "delivery") {
    return copy.delivery;
  }

  return copy.dineIn;
}
