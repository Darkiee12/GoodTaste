import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  carouselWrappedIndex,
  dishCarouselTitle,
  toCarouselPublishedImage,
  type DishCarouselItem,
} from "@/components/dish/dish-carousel";
import { DishMedia } from "@/components/dish/dish-media";
import { usePrefersReducedMotion } from "@/components/home/globe/use-prefers-reduced-motion";
import type { Locale, Messages } from "@/shared/i18n";

/**
 * Thumbnail sizes for the rail. Narrow on purpose: the rail must never
 * pull the full-bleed featured image (1600px candidates stay out of the
 * pick) and every thumbnail loads lazily.
 */
export const RECOMMENDATION_RAIL_THUMB_SIZES = "(max-width: 640px) 40vw, 160px";

export interface RecommendationRailProps {
  /**
   * The SAME ordered list the featured carousel renders (up to ten
   * dishes). Selection is by position, so both components must receive
   * the identical array reference or an identically ordered slice.
   */
  readonly items: ReadonlyArray<DishCarouselItem>;
  /** Shared selected slide; the rail mirrors it, never owns it. */
  readonly activeIndex: number;
  /** Fires with the tapped thumbnail's position; the parent sets the shared index. */
  readonly onSelect: (index: number) => void;
  readonly copy: Messages;
  readonly lang: Locale;
  /**
   * Visible heading + accessible name for the rail (e.g. the "More
   * recommendations" string). Passed in because the i18n key lands with
   * the lead's wiring, not this component.
   */
  readonly label: string;
}

/**
 * Synchronized "More recommendations" thumbnail rail. A horizontal
 * scroller of real dishes only — no placeholders, no filler cards, no
 * "see all" link, no ratings or scores. Tapping a thumbnail selects the
 * featured slide; the active thumbnail stays scrolled into view. The rail
 * renders nothing for empty or single-dish result sets.
 */
export function RecommendationRail({
  activeIndex,
  copy,
  items,
  label,
  lang,
  onSelect,
}: RecommendationRailProps) {
  const total = items.length;
  const headingId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const thumbRefs = useRef(new Map<number, HTMLButtonElement>());
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const safeActive = carouselWrappedIndex(activeIndex, total);

  // Keep the active thumbnail visible as prev/next moves the featured
  // slide. Nearest-edge scrolling never yanks the page; reduced motion
  // gets an instant jump instead of a smooth scroll.
  useEffect(() => {
    if (total <= 1) {
      return;
    }

    thumbRefs.current.get(safeActive)?.scrollIntoView({
      behavior: reducedMotionRef.current ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [safeActive, total]);

  if (total <= 1) {
    return null;
  }

  const handleThumbKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();

    const next =
      event.key === "ArrowRight"
        ? carouselWrappedIndex(safeActive + 1, total)
        : carouselWrappedIndex(safeActive - 1, total);

    onSelect(next);
    thumbRefs.current.get(next)?.focus();
  };

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-extrabold text-ink">
        {label}
      </h3>
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {items.map((dish, thumb) => {
          const title = dishCarouselTitle(dish);
          const selected = thumb === safeActive;

          const regions =
            dish.regionNames.length > 0 ? dish.regionNames.slice(0, 2).join(" · ") : null;

          const description = dish.description ?? null;

          const descriptionLanguage =
            dish.descriptionLanguage !== null &&
            dish.descriptionLanguage !== undefined &&
            dish.descriptionLanguage !== lang
              ? dish.descriptionLanguage
              : undefined;

          return (
            <li key={dish.id} className="w-36 flex-none sm:w-40">
              <button
                ref={(node) => {
                  if (node !== null) {
                    thumbRefs.current.set(thumb, node);
                  } else {
                    thumbRefs.current.delete(thumb);
                  }
                }}
                type="button"
                aria-current={selected}
                aria-label={`${copy.carouselGoTo} ${thumb + 1}: ${title}`}
                onClick={() => {
                  onSelect(thumb);
                }}
                onKeyDown={handleThumbKeyDown}
                className={`group block w-full cursor-pointer overflow-hidden rounded-2xl border-2 bg-white text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none ${
                  selected
                    ? "border-food-orange-strong shadow-[0_8px_20px_rgba(194,65,12,0.18)]"
                    : "border-border-soft hover:border-food-orange"
                }`}
              >
                <span className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-food-orange-strong via-food-orange to-mango">
                  {dish.image === undefined || dish.image === null ? (
                    <span
                      aria-hidden="true"
                      className="font-display grid h-full w-full place-items-center text-3xl text-white"
                    >
                      {title.slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <DishMedia
                      image={toCarouselPublishedImage(dish.image, dish.id)}
                      sizes={RECOMMENDATION_RAIL_THUMB_SIZES}
                      unavailableLabel={copy.carouselPhotoSoon}
                      loadingLabel={title}
                      className="absolute inset-0 h-full w-full"
                    />
                  )}
                </span>
                <span className="block min-w-0 p-3">
                  {regions !== null ? (
                    <span className="block truncate text-[0.65rem] font-bold tracking-[0.14em] text-food-orange-strong uppercase">
                      {regions}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block truncate text-sm font-extrabold text-ink">
                    {title}
                  </span>
                  {dish.nativeName !== undefined ? (
                    <span
                      lang={dish.nativeLanguageTag ?? undefined}
                      className="block truncate text-xs font-semibold text-food-orange-strong"
                    >
                      {dish.nativeName}
                    </span>
                  ) : null}
                  {description !== null ? (
                    <span
                      lang={descriptionLanguage}
                      className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted"
                    >
                      {description}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
