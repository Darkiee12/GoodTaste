import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { DishMedia } from "@/components/dish/dish-media";
import { usePrefersReducedMotion } from "@/components/home/globe/use-prefers-reduced-motion";
import type { DishCardImage, DishSummary } from "@/modules/food-discovery/server/domain/dish";
import type { PublishedDishImage } from "@/modules/food-discovery/server/operations/dish-media-service";
import type { CarouselCard } from "@/modules/food-discovery/server/operations/dish-service";
import {
  SaveDishButton,
  statusForDish,
  type FavoriteStatusQuery,
} from "@/modules/user/components/save-dish-button";
import type { SessionState } from "@/modules/user/session.functions";
import type { Locale, Messages } from "@/shared/i18n";

/**
 * Items the shared carousel consumes. `CarouselCard` (local discovery
 * projection) and `DishSummary` (recommendations, lists) share the fields
 * the slide renders; the helpers below normalize the optional sides so no
 * caller invents a third DTO.
 */
export type DishCarouselItem = CarouselCard | DishSummary;

/** Default autoplay cadence; discovery passes `autoplay` without a value. */
export const DISH_CAROUSEL_AUTOPLAY_MS = 6000;

const SWIPE_THRESHOLD_PX = 48;
const INGREDIENT_PREVIEW_COUNT = 6;

/** Wrap a slide index into `[0, total)`; empty input stays at 0. */
export const carouselWrappedIndex = (next: number, total: number): number => {
  if (total <= 0) {
    return 0;
  }

  return ((next % total) + total) % total;
};

/** Screen-reader announcement for a manual slide change. */
export const carouselAnnouncement = (copy: Messages, index: number, total: number): string =>
  `${copy.carouselSlide} ${index + 1} ${copy.carouselOf} ${total}`;

export const dishCarouselTitle = (item: DishCarouselItem): string =>
  item.name ?? item.englishName ?? item.slug;

/** Display ingredient names for the slide preview, capped at six. */
export const dishCarouselIngredientNames = (item: DishCarouselItem): Array<string> =>
  (item.ingredients ?? [])
    .map((entry) => entry.name ?? null)
    .filter((name): name is string => name !== null)
    .slice(0, INGREDIENT_PREVIEW_COUNT);

/**
 * Single place owning card-image normalization. Both projections already
 * carry the published+ready shape; every field falls back defensively so
 * older payloads still render (without srcSet/focal/dimensions) instead of
 * crashing. `license` never crosses into the public shape — publication
 * licensing is enforced at the publish boundary. Never invents a photo:
 * absent input projects to null and the slide renders the honest fallback.
 */
export const toCarouselPublishedImage = (
  image: DishCardImage | PublishedDishImage | null | undefined,
  dishId: string,
): PublishedDishImage | null => {
  if (image === null || image === undefined) {
    return null;
  }

  return {
    id: image.id ?? dishId,
    dishId: image.dishId ?? dishId,
    url: image.url,
    srcSet: image.srcSet ?? null,
    alt: image.alt,
    attribution: image.attribution,
    focalX: image.focalX ?? null,
    focalY: image.focalY ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  };
};

/** Display index resolution shared by both carousel modes. The controlled
 * `activeIndex` wins when provided; otherwise the internal fallback (the
 * uncontrolled state) shows. Out-of-range values wrap; empty input stays
 * at 0. Exported so the controlled-mode contract is unit-testable without
 * a DOM renderer. */
export const carouselDisplayIndex = (
  activeIndex: number | undefined,
  fallbackIndex: number,
  total: number,
): number => carouselWrappedIndex(activeIndex ?? fallbackIndex, total);

export interface DishCarouselProps {
  /** One to ten dishes; empty states stay with the caller (no empty carousel). */
  readonly items: ReadonlyArray<DishCarouselItem>;
  readonly copy: Messages;
  readonly lang: Locale;
  readonly session: SessionState;
  readonly favoriteStatus: FavoriteStatusQuery;
  /** Accessible name for the carousel region (the visible heading text). */
  readonly label: string;
  /**
   * Controlled selected slide. When set, the parent owns the index: the
   * carousel renders it (wrapped into range) and reports every user or
   * autoplay change through `onIndexChange` instead of moving internal
   * state. Omit for the default uncontrolled behavior (Discover).
   */
  readonly activeIndex?: number | undefined;
  /**
   * Fires with the wrapped index on every slide change — prev/next, dots,
   * arrows, swipe, and autoplay — in both modes. The rail parent passes a
   * state setter here; uncontrolled callers may omit it.
   */
  readonly onIndexChange?: ((index: number) => void) | undefined;
  /** Autoplay timer; defaults to off (recommendation results stay still). */
  readonly autoplay?: boolean | undefined;
  readonly autoplayMs?: number | undefined;
  /** Index resets to the first slide whenever this value changes. */
  readonly resetKey?: string | number | undefined;
}

/**
 * Shared featured-slide dish carousel: one large image+info slide at a
 * time (stacked on mobile, side-by-side on desktop), prev/next + dots +
 * counter, arrow-key and touch-swipe navigation, autoplay that pauses on
 * hover/focus/off-screen and never runs under reduced motion, and
 * inert+hidden inactive slides so keyboard focus never lands off-screen.
 * Recommendation-specific content (AI note, summary, warnings) stays with
 * the caller, outside this component.
 */
export function DishCarousel({
  activeIndex,
  autoplay = false,
  autoplayMs = DISH_CAROUSEL_AUTOPLAY_MS,
  copy,
  favoriteStatus,
  items,
  label,
  lang,
  onIndexChange,
  resetKey,
  session,
}: DishCarouselProps): ReactNode {
  const controlled = activeIndex !== undefined;
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);
  const [activeResetKey, setActiveResetKey] = useState(resetKey);
  const [playing, setPlaying] = useState(true);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const sectionRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Render-time reset (the endorsed pattern): the discarded render never
  // commits, so no stale-index frame paints when the scope or rotation
  // changes underneath the carousel. Controlled parents own the reset and
  // return `activeIndex` to 0 alongside the new `resetKey`; uncontrolled
  // mode resets its internal index here.
  if (resetKey !== activeResetKey) {
    setActiveResetKey(resetKey);

    if (!controlled) {
      setUncontrolledIndex(0);
    }
  }

  const total = items.length;

  const running =
    autoplay && playing && !reducedMotion && !hoverPaused && !focusPaused && inView && total > 1;

  useEffect(() => {
    const node = sectionRef.current;

    // Container-level behavior: the carousel section itself is not an
    // interactive element for JSX mouse/focus props.
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

  const safeIndex = carouselDisplayIndex(activeIndex, uncontrolledIndex, total);

  // Latest control-channel snapshot for the autoplay timer. The timer effect
  // intentionally keeps its original dependency set (running/total/ms) so
  // Discover autoplay cadence is untouched; refs carry the live values.
  const controlRef = useRef({ controlled, onIndexChange });
  useEffect(() => {
    controlRef.current = { controlled, onIndexChange };
  });

  const liveIndexRef = useRef(safeIndex);
  useEffect(() => {
    liveIndexRef.current = safeIndex;
  });

  useEffect(() => {
    // Autoplay advances silently: manual navigation announces via the
    // live region, the timer never spams screen readers.
    const timer = window.setTimeout(() => {
      if (running) {
        const wrapped = carouselWrappedIndex(liveIndexRef.current + 1, total);

        if (!controlRef.current.controlled) {
          setUncontrolledIndex(wrapped);
        }

        controlRef.current.onIndexChange?.(wrapped);
      }
    }, autoplayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [running, total, autoplayMs]);

  // Empty states stay with the caller; every hook above still ran.
  if (total === 0) {
    return null;
  }

  const goTo = (next: number): void => {
    const wrapped = carouselWrappedIndex(next, total);

    if (!controlled) {
      setUncontrolledIndex(wrapped);
    }

    onIndexChange?.(wrapped);
    setAnnouncement(carouselAnnouncement(copy, wrapped, total));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === "ArrowLeft") {
      goTo(safeIndex - 1);
    } else if (event.key === "ArrowRight") {
      goTo(safeIndex + 1);
    }
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>): void => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLElement>): void => {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX ?? null;
    touchStartX.current = null;

    if (start === null || end === null) {
      return;
    }

    const delta = end - start;

    if (delta <= -SWIPE_THRESHOLD_PX) {
      goTo(safeIndex + 1);
    } else if (delta >= SWIPE_THRESHOLD_PX) {
      goTo(safeIndex - 1);
    }
  };

  return (
    <section ref={sectionRef} aria-roledescription="carousel" aria-label={label}>
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="discover-carousel-viewport touch-pan-y"
      >
        <div
          className="discover-carousel-track"
          style={{ transform: `translateX(-${safeIndex * 100}%)` }}
        >
          {items.map((dish, slide) => {
            const title = dishCarouselTitle(dish);
            const shown = slide === safeIndex;
            const ingredientNames = dishCarouselIngredientNames(dish);
            const description = dish.description ?? null;

            const descriptionLanguage =
              dish.descriptionLanguage !== null &&
              dish.descriptionLanguage !== undefined &&
              dish.descriptionLanguage !== lang
                ? dish.descriptionLanguage
                : undefined;

            return (
              <article
                key={dish.id}
                aria-label={`${copy.carouselSlide} ${slide + 1} ${copy.carouselOf} ${total}`}
                aria-hidden={shown ? undefined : true}
                inert={shown ? undefined : true}
                className="grid w-full flex-none gap-0 overflow-hidden rounded-3xl border border-border-soft bg-white shadow-[0_12px_28px_rgba(194,65,12,0.08)] md:grid-cols-[45%_55%]"
              >
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-food-orange-strong via-food-orange to-mango md:aspect-auto md:min-h-[22rem]"
                  title={dish.image?.attribution ?? undefined}
                >
                  <DishMedia
                    image={toCarouselPublishedImage(dish.image ?? null, dish.id)}
                    eager={slide === 0}
                    sizes="(max-width:640px) 100vw, 50vw"
                    unavailableLabel={copy.carouselPhotoSoon}
                    loadingLabel={copy.discoverLocalLoading}
                    className="absolute inset-0 h-full w-full"
                  />
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
                  {description !== null ? (
                    <p
                      lang={descriptionLanguage}
                      className="mt-1 line-clamp-4 text-[0.95rem] leading-relaxed text-ink"
                    >
                      {description}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted italic">{copy.carouselNoDescription}</p>
                  )}
                  {ingredientNames.length > 0 ? (
                    <div className="mt-1">
                      <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                        {copy.carouselIngredients}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {ingredientNames.join(" · ")}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted italic">{copy.carouselNoIngredients}</p>
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
              goTo(safeIndex - 1);
            }}
            onKeyDown={handleKeyDown}
            aria-label={copy.carouselPrev}
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-white px-3 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              goTo(safeIndex + 1);
            }}
            onKeyDown={handleKeyDown}
            aria-label={copy.carouselNext}
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-white px-3 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
          >
            →
          </button>
          {autoplay ? (
            <button
              type="button"
              onClick={() => {
                setPlaying((value) => !value);
              }}
              onKeyDown={handleKeyDown}
              aria-label={playing ? copy.carouselPause : copy.carouselPlay}
              aria-pressed={playing}
              className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 border-border-soft bg-white px-3 text-sm font-bold text-ink transition hover:border-ink"
            >
              {playing ? "❚❚" : "▶"}
            </button>
          ) : null}
          <div className="flex items-center gap-1.5" aria-label={label}>
            {items.map((dish, dot) => (
              <button
                key={dish.id}
                type="button"
                aria-current={dot === safeIndex}
                aria-label={`${copy.carouselGoTo} ${dot + 1}`}
                onClick={() => {
                  goTo(dot);
                }}
                onKeyDown={handleKeyDown}
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
  );
}

/**
 * Loading skeleton mirroring the featured-slide layout: fixed-aspect media
 * block plus text lines at the same padding, so content resolves without
 * layout shift. Announced once via the caller's loading region, not here.
 */
export function DishCarouselSkeleton(): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="grid w-full gap-0 overflow-hidden rounded-3xl border border-border-soft bg-white md:grid-cols-[45%_55%]"
    >
      <div className="aspect-[4/3] w-full animate-pulse bg-border-soft motion-reduce:animate-none md:aspect-auto md:min-h-[22rem]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-6 sm:p-8" aria-hidden="true">
        <div className="h-3 w-1/3 animate-pulse rounded bg-border-soft motion-reduce:animate-none" />
        <div className="h-10 w-3/4 animate-pulse rounded bg-border-soft motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-cream motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-cream motion-reduce:animate-none" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-cream motion-reduce:animate-none" />
        <div className="mt-auto flex gap-3 pt-4">
          <div className="h-11 w-36 animate-pulse rounded-full bg-cream motion-reduce:animate-none" />
          <div className="h-11 w-28 animate-pulse rounded-full bg-cream motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
