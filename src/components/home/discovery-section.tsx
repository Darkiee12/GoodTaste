import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/components/home/globe/use-prefers-reduced-motion";
import { sanitizeCountryCode } from "@/components/home/recommend/quiz-model";
import {
  fallbackOptionsFor,
  usePreciseLocation,
} from "@/components/home/recommend/use-precise-location";
import {
  getLocalCarouselFn,
  getVisitorRegionFn,
  listCountriesFn,
} from "@/modules/food-discovery/food.functions";
import { getQuizRegionFn } from "@/modules/food-discovery/quiz.functions";
import {
  SaveDishButton,
  statusForDish,
  useFavoriteStatus,
} from "@/modules/user/components/save-dish-button";
import type { VisitorRegion } from "@/server/geo/visitor-region";
import type { Locale, Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const CAROUSEL_LIMIT = 5;
const AUTOPLAY_MS = 6000;

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
 * Homepage local food carousel: one featured dish at a time, auto-advancing
 * every few seconds with manual controls. Dishes come from a single
 * server-side projection keyed by visitor coordinates (nearest real catalog
 * associations) or region, falling back to an explicit worldwide browse —
 * never random picks labeled as local. No dish images exist in the catalog
 * yet, so cards without approved media render a deliberate placeholder in
 * the same fixed media slot.
 */
export function DiscoverySection({ copy, lang }: { copy: Messages; lang: Locale }) {
  const { session } = rootRoute.useRouteContext();

  // Precise location is explicit-only: the shared locator never prompts on
  // mount or on render. The carousel starts from the trusted approximate
  // region and upgrades to coordinates only after the visitor taps the
  // precise action below.
  const precise = usePreciseLocation();

  const [worldwide, setWorldwide] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const sectionRef = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = sectionRef.current;

    // Native listeners: pausing autoplay is container-level behavior, and
    // the landmark section itself is not an interactive element for JSX
    // mouse/focus props.
    const onPointerEnter = (): void => {
      setHoverPaused(true);
    };

    const onPointerLeave = (): void => {
      setHoverPaused(false);
    };

    const onFocusIn = (): void => {
      setFocusPaused(true);
    };

    const onFocusOut = (): void => {
      setFocusPaused(false);
    };

    let observer: IntersectionObserver | undefined;

    if (node !== null) {
      node.addEventListener("pointerenter", onPointerEnter);
      node.addEventListener("pointerleave", onPointerLeave);
      node.addEventListener("focusin", onFocusIn);
      node.addEventListener("focusout", onFocusOut);

      if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver(
          (entries) => {
            setInView(entries[0]?.isIntersecting ?? true);
          },
          { threshold: 0.2 },
        );
        observer.observe(node);
      }
    }

    return () => {
      node?.removeEventListener("pointerenter", onPointerEnter);
      node?.removeEventListener("pointerleave", onPointerLeave);
      node?.removeEventListener("focusin", onFocusIn);
      node?.removeEventListener("focusout", onFocusOut);
      observer?.disconnect();
    };
  }, []);

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

  const region = regionQuery.data ?? null;
  const country = worldwide ? null : (trustedCountry ?? region?.country ?? null);
  const where = worldwide ? null : (locationLabel(region) ?? trustedName);
  const preciseFix = precise.status === "success" ? precise.fix : null;
  const located = worldwide || preciseFix !== null || country !== null;

  // Coordinates never enter the query key: the precise scope is the
  // locator's success counter, so re-locating refetches without persisting
  // visitor coordinates in the cache.
  let scopeKey: string | null = null;

  if (worldwide) {
    scopeKey = "world";
  } else if (preciseFix !== null) {
    scopeKey = `nearby-${precise.successCount.toString()}`;
  } else if (country !== null) {
    scopeKey = `country-${country}`;
  }

  const carouselQuery = useQuery({
    enabled: scopeKey !== null,
    queryKey: ["catalog", "local-carousel", lang, scopeKey ?? "none"],
    queryFn: () => {
      if (worldwide) {
        return getLocalCarouselFn({
          data: { limit: CAROUSEL_LIMIT, locale: lang, worldwide: true },
        });
      }

      if (preciseFix !== null) {
        return getLocalCarouselFn({
          data: {
            latitude: preciseFix.latitude,
            limit: CAROUSEL_LIMIT,
            locale: lang,
            longitude: preciseFix.longitude,
          },
        });
      }

      if (country !== null) {
        return getLocalCarouselFn({ data: { country, limit: CAROUSEL_LIMIT, locale: lang } });
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
  const safeIndex = total === 0 ? 0 : index % total;
  const active = total === 0 ? undefined : items[safeIndex];

  const running = playing && !reducedMotion && !hoverPaused && !focusPaused && inView && total > 1;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (running) {
        setIndex(total === 0 ? 0 : (index + 1) % total);
      }
    }, AUTOPLAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [running, index, total]);

  const goTo = (next: number, announce: boolean): void => {
    if (total === 0) {
      return;
    }

    const wrapped = ((next % total) + total) % total;
    setIndex(wrapped);

    if (announce) {
      setAnnouncement(`${copy.carouselSlide} ${wrapped + 1} ${copy.carouselOf} ${total}`);
    }
  };

  let locationLine = copy.discoverLocalUnknown;

  if (worldwide) {
    locationLine = copy.carouselWorldwide;
  } else if (preciseFix !== null) {
    locationLine = copy.discoverLocalNearYou;
  } else if (where !== null) {
    locationLine = `${copy.discoverLocalNear}: ${where}`;
  }

  const loading =
    regionQuery.isPending ||
    quizRegionQuery.isPending ||
    (scopeKey !== null && carouselQuery.isPending);

  const failed = carouselQuery.isError || regionQuery.isError;

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
      ref={sectionRef}
      aria-labelledby="discover-heading"
      className="scroll-mt-18 bg-cream px-5 py-16 sm:px-8"
    >
      <div className="mx-auto max-w-6xl">
        <h2
          id="discover-heading"
          className="font-display mb-3 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] tracking-[0.015em] text-balance"
        >
          {copy.discoverLocalTitle}
        </h2>

        <p className="mb-2 max-w-[60ch] text-lg font-bold text-ink">{locationLine}</p>

        <p className="mb-8 max-w-[60ch] text-lg text-muted">{copy.discoverLocalSub}</p>

        {!worldwide && precise.status !== "success" ? (
          <div className="mb-8 flex flex-wrap items-center gap-3">
            {precise.status === "locating" ? (
              <output className="text-sm font-bold text-muted">{copy.discoverLocalLoading}</output>
            ) : (
              <button
                type="button"
                onClick={precise.request}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
              >
                {copy.recWhereNearYou}
              </button>
            )}
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
        ) : null}

        {loading ? (
          <output className="block text-base font-semibold text-muted">
            {copy.discoverLocalLoading}
          </output>
        ) : null}

        {!loading && failed ? (
          <p
            role="alert"
            className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
          >
            {copy.discoverLocalError}
          </p>
        ) : null}

        {!loading && !failed && !located ? (
          <p className="text-base text-muted">{copy.discoverLocalUnknown}</p>
        ) : null}

        {!loading && !failed && located && total === 0 ? (
          <div>
            <p className="text-base text-muted">{copy.carouselRegionEmpty}</p>
            {!worldwide ? (
              <button
                type="button"
                onClick={() => {
                  setWorldwide(true);
                  setIndex(0);
                }}
                className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
              >
                {copy.carouselExploreWorld}
              </button>
            ) : null}
          </div>
        ) : null}

        {total > 0 && active !== undefined ? (
          <section aria-roledescription="carousel" aria-label={copy.discoverLocalTitle}>
            <output aria-live="polite" className="sr-only">
              {announcement}
            </output>
            <div className="discover-carousel-viewport">
              <div
                className="discover-carousel-track"
                style={{ transform: `translateX(-${safeIndex * 100}%)` }}
              >
                {items.map((dish, slide) => {
                  const title = dish.name ?? dish.englishName ?? dish.slug;
                  const shown = slide === safeIndex;

                  return (
                    <article
                      key={dish.id}
                      aria-label={`${copy.carouselSlide} ${slide + 1} ${copy.carouselOf} ${total}`}
                      aria-hidden={shown ? undefined : true}
                      inert={shown ? undefined : true}
                      className="grid w-full flex-none gap-0 overflow-hidden rounded-3xl border border-border-soft bg-white shadow-[0_12px_28px_rgba(194,65,12,0.08)] md:grid-cols-[45%_55%]"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-food-orange-strong via-food-orange to-mango md:aspect-auto md:min-h-[22rem]">
                        {dish.image !== null ? (
                          <img
                            src={dish.image.url}
                            alt={dish.image.alt ?? title}
                            loading={slide === 0 ? "eager" : "lazy"}
                            style={
                              dish.image.focalX !== null && dish.image.focalY !== null
                                ? {
                                    objectPosition: `${Math.round(dish.image.focalX * 100)}% ${Math.round(dish.image.focalY * 100)}%`,
                                  }
                                : undefined
                            }
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
                          >
                            <span className="text-6xl">🍽️</span>
                            <span className="text-sm font-bold text-white/90">
                              {copy.carouselPhotoSoon}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2 p-6 sm:p-8">
                        {dish.regionNames.length > 0 ? (
                          <p className="text-xs font-bold tracking-[0.18em] text-food-orange-strong uppercase">
                            {dish.regionNames.slice(0, 2).join(" · ")}
                          </p>
                        ) : null}
                        <h3 className="font-display text-4xl leading-none tracking-wide text-balance sm:text-5xl">
                          {title}
                        </h3>
                        {dish.nativeName !== undefined ? (
                          <p lang={dish.nativeLanguageTag} className="text-xl font-bold text-ink">
                            {dish.nativeName}
                          </p>
                        ) : null}
                        {dish.description !== null ? (
                          <p
                            lang={
                              dish.descriptionLanguage !== null && dish.descriptionLanguage !== lang
                                ? dish.descriptionLanguage
                                : undefined
                            }
                            className="mt-1 line-clamp-4 text-[0.95rem] leading-relaxed text-ink"
                          >
                            {dish.description}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-muted italic">
                            {copy.carouselNoDescription}
                          </p>
                        )}
                        {dish.ingredients.length > 0 ? (
                          <div className="mt-1">
                            <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                              {copy.carouselIngredients}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-ink">
                              {dish.ingredients
                                .map((entry) => entry.name ?? null)
                                .filter((name): name is string => name !== null)
                                .slice(0, 6)
                                .join(" · ") || copy.carouselNoIngredients}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-1 text-sm text-muted italic">
                            {copy.carouselNoIngredients}
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
                          <Link
                            to="/dishes/$dishId"
                            params={{ dishId: dish.slug }}
                            search={{ lang }}
                            tabIndex={shown ? undefined : -1}
                            className="inline-flex min-h-11 items-center rounded-full bg-food-orange-strong px-6 text-sm font-bold text-white transition hover:bg-food-orange-dark"
                          >
                            {copy.carouselExploreDish} →
                          </Link>
                          <SaveDishButton
                            dishId={dish.id}
                            lang={lang}
                            returnTo="/"
                            session={session}
                            status={statusForDish(favoriteStatus, dish.id)}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            {total > 1 ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    goTo(safeIndex - 1, true);
                  }}
                  aria-label={copy.carouselPrev}
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-white px-3 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => {
                    goTo(safeIndex + 1, true);
                  }}
                  aria-label={copy.carouselNext}
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-white px-3 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying((value) => !value);
                  }}
                  aria-label={playing ? copy.carouselPause : copy.carouselPlay}
                  aria-pressed={playing}
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-border-soft bg-white px-3 text-sm font-bold text-ink transition hover:border-ink"
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <div className="flex items-center gap-1.5" aria-label={copy.discoverLocalTitle}>
                  {items.map((dish, dot) => (
                    <button
                      key={dish.id}
                      type="button"
                      aria-current={dot === safeIndex}
                      aria-label={`${copy.carouselGoTo} ${dot + 1}`}
                      onClick={() => {
                        goTo(dot, true);
                      }}
                      className={`size-3 cursor-pointer rounded-full transition ${
                        dot === safeIndex ? "bg-ink" : "bg-border-soft hover:bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-sm font-bold text-muted">
                  {copy.carouselSlide} {safeIndex + 1} {copy.carouselOf} {total}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}
