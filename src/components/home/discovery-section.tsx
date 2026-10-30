import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Globe2Icon, LocateFixedIcon, MapPinIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { DishCarousel, DishCarouselSkeleton } from "@/components/dish/dish-carousel";
import { sanitizeCountryCode } from "@/components/home/recommend/quiz-model";
import {
  accuracyLabelFor,
  fallbackOptionsFor,
  isPoorAccuracy,
  usePreciseLocation,
} from "@/components/home/recommend/use-precise-location";
import {
  getLocalCarouselFn,
  getVisitorRegionFn,
  listCountriesFn,
} from "@/modules/food-discovery/food.functions";
import { getQuizRegionFn } from "@/modules/food-discovery/quiz.functions";
import { useFavoriteStatus } from "@/modules/user/components/save-dish-button";
import type { VisitorRegion } from "@/server/geo/visitor-region";
import type { Locale, Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const CAROUSEL_LIMIT = 5;

function locationLabel(region: VisitorRegion | null): string | null {
  if (region === null) {
    return null;
  }

  const parts = [region.city, region.regionCode ?? region.region, region.country].filter(
    (part): part is string => part !== null && part !== "",
  );

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Homepage food carousel with honest scopes: the heading names the
 * trusted network country when one is known, and the scope line always
 * says what the cards actually show — network area, precise fix,
 * or worldwide (manual or automatic fallback when no region resolved).
 * Dishes come from a single server-side projection keyed by visitor
 * coordinates (nearest real catalog associations) or region, falling
 * back to an explicit worldwide browse — never random picks labeled as
 * local. Geolocation only runs on explicit tap; coordinates never enter
 * query keys or persisted state.
 */
export function DiscoverySection({ copy, lang }: { copy: Messages; lang: Locale }) {
  const { session } = rootRoute.useRouteContext();

  // Precise location is explicit-only: the shared locator never prompts on
  // mount or on render. The carousel starts from the trusted approximate
  // region and upgrades to coordinates only after the visitor taps the
  // precise action below.
  const precise = usePreciseLocation();

  const [worldwide, setWorldwide] = useState(false);
  // Rotation seed for the carousel selection: same scope + same seed renders
  // the same set (stable within the session); bumping it renders another
  // set. Reset explicitly on scope change, preserved otherwise.
  const [rotation, setRotation] = useState(0);
  const [activeScope, setActiveScope] = useState<string | null>(null);

  const regionQuery = useQuery({
    queryKey: ["geo", "visitor-region"],
    queryFn: () => getVisitorRegionFn(),
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Trusted approximate country shared with the quiz cache key, so the
  // homepage issues one region request, not two. The carousel filters by
  // this country first and falls back to the header-derived visitor region.
  const quizRegionQuery = useQuery({
    queryKey: ["geo", "quiz-region"],
    queryFn: () => getQuizRegionFn(),
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const trustedCountry = sanitizeCountryCode(quizRegionQuery.data?.country ?? "");

  const countriesQuery = useQuery({
    queryKey: ["catalog", "countries", lang],
    queryFn: () => listCountriesFn({ data: { locale: lang } }),
    retry: 1,
    staleTime: 5 * 60_000,
  });

  const trustedName =
    trustedCountry === null
      ? null
      : ((countriesQuery.data ?? []).find((entry) => entry.iso3166 === trustedCountry)
          ?.displayName ?? trustedCountry);

  let heading = copy.discoverLocalTitle;

  if (trustedName !== null) {
    heading =
      lang === "vi" ? `Khám phá món ngon tại ${trustedName}` : `Discover Food in ${trustedName}`;
  }

  const region = regionQuery.data ?? null;
  const country = worldwide ? null : (trustedCountry ?? region?.country ?? null);
  const where = worldwide ? null : (locationLabel(region) ?? trustedName);
  const preciseFix = precise.status === "success" ? precise.fix : null;
  const geoSettled = !regionQuery.isPending && !quizRegionQuery.isPending;

  // Coordinates never enter the query key: the precise scope is the
  // locator's success counter, so re-locating refetches without persisting
  // visitor coordinates in the cache. When geography settles with no
  // country and no precise fix, the carousel falls back to an explicitly
  // labeled automatic worldwide scope instead of rendering nothing.
  let scopeKey: string | null = null;

  if (worldwide) {
    scopeKey = "world";
  } else if (preciseFix !== null) {
    scopeKey = `nearby-${precise.successCount.toString()}`;
  } else if (country !== null) {
    scopeKey = `country-${country}`;
  } else if (geoSettled) {
    scopeKey = "world-auto";
  }

  const isAutoWorldwide = scopeKey === "world-auto";
  const located = worldwide || preciseFix !== null || country !== null || isAutoWorldwide;

  // Reset rotation explicitly when the scope changes (React
  // endorsed render-time adjustment: the discarded render never commits, so
  // no stale-seed fetch fires). The shared carousel resets its own slide
  // from the same scope signal via resetKey.
  if (scopeKey !== activeScope) {
    setActiveScope(scopeKey);
    setRotation(0);
  }

  const carouselQuery = useQuery({
    enabled: scopeKey !== null,
    queryKey: ["catalog", "local-carousel", lang, scopeKey ?? "none", rotation],
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (scopeKey === "world" || scopeKey === "world-auto") {
        return getLocalCarouselFn({
          data: { limit: CAROUSEL_LIMIT, locale: lang, seed: rotation, worldwide: true },
        });
      }

      if (preciseFix !== null) {
        return getLocalCarouselFn({
          data: {
            country: country ?? undefined,
            latitude: preciseFix.latitude,
            limit: CAROUSEL_LIMIT,
            locale: lang,
            longitude: preciseFix.longitude,
            seed: rotation,
          },
        });
      }

      if (country !== null) {
        return getLocalCarouselFn({
          data: { country, limit: CAROUSEL_LIMIT, locale: lang, seed: rotation },
        });
      }

      throw new Error("location not ready");
    },
    retry: 1,
    staleTime: 60_000,
  });

  const items = carouselQuery.data?.items ?? [];
  const total = items.length;
  const visibleIds = items.map((dish) => dish.id);
  const userId = session.status === "signed-in" ? session.user.id : null;
  const favoriteStatus = useFavoriteStatus(visibleIds, userId);

  // Explicit refresh: a new rotation seed renders another set from the same
  // scope. keepPreviousData keeps the current cards visible while the new
  // set loads, so there is no empty-state flash mid-refresh.
  const showAnotherSet = (): void => {
    setRotation((value) => value + 1);
  };

  // The scope line follows the scope actually served, not the scope asked
  // for: a precise request that falls back to country dishes is labeled as
  // the network area, never as "near you".
  const resolvedScope = carouselQuery.data?.scope ?? null;

  let locationLine = copy.discoverLocalUnknown;

  if (worldwide || isAutoWorldwide) {
    locationLine = copy.carouselWorldwide;
  } else if (preciseFix !== null && resolvedScope !== "country") {
    const accuracy = isPoorAccuracy(preciseFix) ? accuracyLabelFor(preciseFix) : null;

    if (accuracy !== null) {
      locationLine = `${copy.discoverLocalNearYou} (${accuracy})`;
    } else {
      locationLine = copy.discoverLocalNearYou;
    }
  } else if (where !== null) {
    locationLine = `${copy.discoverLocalNear}: ${where}`;
  }

  const loading =
    regionQuery.isPending ||
    quizRegionQuery.isPending ||
    (scopeKey !== null && carouselQuery.isPending);

  const failed = carouselQuery.isError || regionQuery.isError || quizRegionQuery.isError;

  const preciseFailed =
    precise.status === "denied" ||
    precise.status === "timeout" ||
    precise.status === "unavailable" ||
    precise.status === "unsupported" ||
    precise.status === "insecure";

  const preciseRetryable = fallbackOptionsFor(precise.status, null).some(
    (option) => option.retryPrecise,
  );

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
          {heading}
        </h2>

        <p className="mb-2 max-w-[60ch] text-lg font-bold text-ink">{locationLine}</p>

        <p className="mb-8 max-w-[60ch] text-lg text-muted">{copy.discoverLocalSub}</p>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          {!worldwide && precise.status === "locating" ? (
            <output className="text-sm font-bold text-muted">{copy.discoverLocalLoading}</output>
          ) : null}
          {!worldwide && precise.status !== "success" && precise.status !== "locating" ? (
            <button
              type="button"
              onClick={precise.request}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
            >
              <LocateFixedIcon aria-hidden="true" className="size-4 flex-none" />
              {lang === "vi" ? "Dùng vị trí chính xác" : "Use precise location"}
            </button>
          ) : null}
          {!worldwide && precise.status === "success" ? (
            <button
              type="button"
              onClick={() => {
                precise.reset();
              }}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
            >
              <MapPinIcon aria-hidden="true" className="size-4 flex-none" />
              {lang === "vi" ? "Về vùng mạng" : "Back to network region"}
            </button>
          ) : null}
          {!worldwide ? (
            <button
              type="button"
              onClick={() => {
                setWorldwide(true);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
            >
              <Globe2Icon aria-hidden="true" className="size-4 flex-none" />
              {copy.carouselExploreWorld}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setWorldwide(false);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
            >
              <Globe2Icon aria-hidden="true" className="size-4 flex-none" />
              {lang === "vi" ? "Về vùng của bạn" : "Back to region"}
            </button>
          )}
          <Link
            to="/"
            search={{ lang }}
            hash="recommend"
            resetScroll={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
          >
            <MapPinIcon aria-hidden="true" className="size-4 flex-none" />
            {copy.recWhereAnother}
          </Link>
          {preciseFailed ? (
            <p
              role="alert"
              className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
            >
              {copy.recError}
            </p>
          ) : null}
          {preciseFailed && preciseRetryable ? (
            <button
              type="button"
              onClick={precise.request}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
            >
              {copy.recRetry}
            </button>
          ) : null}
        </div>

        {loading ? (
          <div>
            <output className="block text-base font-semibold text-muted">
              {copy.discoverLocalLoading}
            </output>
            <div className="mt-4">
              <DishCarouselSkeleton />
            </div>
          </div>
        ) : null}

        {!loading && failed ? (
          <p
            role="alert"
            className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
          >
            {copy.discoverLocalError}
          </p>
        ) : null}

        {!loading && !failed && !located && geoSettled ? (
          <p className="text-base text-muted">{copy.discoverLocalUnknown}</p>
        ) : null}

        {!loading && !failed && located && total === 0 ? (
          <div>
            <p className="text-base text-muted">{copy.carouselRegionEmpty}</p>
            {!worldwide && !isAutoWorldwide ? (
              <button
                type="button"
                onClick={() => {
                  setWorldwide(true);
                }}
                className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
              >
                <Globe2Icon aria-hidden="true" className="size-4 flex-none" />
                {copy.carouselExploreWorld}
              </button>
            ) : null}
          </div>
        ) : null}

        {total > 0 ? (
          <div>
            <DishCarousel
              autoplay
              copy={copy}
              favoriteStatus={favoriteStatus}
              items={items}
              label={heading}
              lang={lang}
              resetKey={`${scopeKey ?? "pending"}:${rotation}`}
              session={session}
            />
            <div className="mt-4">
              <button
                type="button"
                onClick={showAnotherSet}
                aria-label={lang === "vi" ? "Xem loạt món khác" : "Show another set"}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border-soft bg-white px-5 text-sm font-bold text-ink transition hover:border-ink"
              >
                <RefreshCwIcon aria-hidden="true" className="size-4 flex-none" />
                {lang === "vi" ? "Xem loạt món khác" : "Show another set"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
