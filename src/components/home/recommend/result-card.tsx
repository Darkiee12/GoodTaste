import { Link } from "@tanstack/react-router";

import { toCarouselPublishedImage } from "@/components/dish/dish-carousel";
import { DishMedia } from "@/components/dish/dish-media";
import type { DishSummary } from "@/modules/food-discovery/server/domain/dish";
import {
  SaveDishButton,
  statusForDish,
  type FavoriteStatusQuery,
} from "@/modules/user/components/save-dish-button";
import type { SessionState } from "@/modules/user/session.functions";
import type { Locale, Messages } from "@/shared/i18n";

const displayTitle = (dish: DishSummary): string => dish.name ?? dish.englishName ?? dish.slug;

const initialFor = (dish: DishSummary): string => displayTitle(dish).slice(0, 1).toUpperCase();

/**
 * Image-led recommendation card. The media slot is fixed (no layout shift):
 * a real dish photo when the catalog provides one, otherwise the branded
 * initial tile — never a fabricated photo. The photo normalizes through the
 * shared carousel projection. Actions mirror the local
 * discovery cards: Explore plus the member save button.
 */
export function ResultCard({
  copy,
  dish,
  favoriteStatus,
  lang,
  session,
}: {
  readonly copy: Messages;
  readonly dish: DishSummary;
  readonly favoriteStatus: FavoriteStatusQuery;
  readonly lang: Locale;
  readonly session: SessionState;
}) {
  const title = displayTitle(dish);
  const chips = [...dish.regionNames, ...dish.categorySlugs];
  const ingredients = dish.ingredients ?? [];

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-white transition hover:-translate-y-0.5 hover:border-food-orange motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div
        className="relative aspect-[16/10] w-full flex-none overflow-hidden bg-cream"
        title={dish.image?.attribution ?? undefined}
      >
        {dish.image === undefined || dish.image === null ? (
          <span
            aria-hidden="true"
            className="font-display grid h-full w-full place-items-center bg-gradient-to-br from-food-orange-strong to-mango text-6xl text-white"
          >
            {initialFor(dish)}
          </span>
        ) : (
          <DishMedia
            image={toCarouselPublishedImage(dish.image, dish.id)}
            className="absolute inset-0 h-full w-full"
            unavailableLabel={copy.carouselPhotoSoon}
            loadingLabel={title}
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-6">
        <h3 className="text-lg leading-tight font-extrabold">
          <Link
            to="/dishes/$dishId"
            params={{ dishId: dish.slug }}
            search={{ lang }}
            className="underline decoration-food-orange/60 underline-offset-4 hover:text-food-orange-strong"
          >
            {title}
          </Link>
        </h3>
        {dish.nativeName !== undefined ? (
          <p
            className="text-sm font-semibold text-food-orange-strong"
            lang={dish.nativeLanguageTag ?? undefined}
          >
            {dish.nativeName}
          </p>
        ) : null}
        {dish.englishName !== undefined &&
        dish.name !== undefined &&
        dish.name !== dish.englishName ? (
          <p className="text-sm font-semibold text-food-orange-strong">{dish.englishName}</p>
        ) : null}
        {dish.description !== undefined && dish.description !== null ? (
          <p className="line-clamp-3 text-[0.95rem] text-ink">{dish.description}</p>
        ) : null}
        {ingredients.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={copy.carouselIngredients}>
            {ingredients.map((ingredient, index) => (
              <li
                key={`${ingredient.role}-${ingredient.name ?? "unknown"}-${index.toString()}`}
                className="rounded-full border border-border-soft bg-cream px-2.5 py-0.5 text-xs font-bold text-muted"
              >
                {ingredient.name ?? ingredient.role}
              </li>
            ))}
          </ul>
        ) : null}
        {chips.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded-full border border-border-soft bg-cream px-2.5 py-0.5 text-xs font-bold text-muted"
              >
                {chip}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          <Link
            to="/dishes/$dishId"
            params={{ dishId: dish.slug }}
            search={{ lang }}
            className="inline-flex min-h-11 items-center text-sm font-bold text-brand-blue-hover underline underline-offset-4"
          >
            {copy.recViewDish}
          </Link>
          <SaveDishButton
            dishId={dish.id}
            lang={lang}
            returnTo="/"
            session={session}
            status={statusForDish(favoriteStatus, dish.id)}
          />
        </p>
      </div>
    </article>
  );
}

/**
 * Loading skeleton mirroring the result card layout: fixed media block plus
 * text lines, so content resolves without layout shift. Announced once via
 * the caller's aria-busy region, not per card.
 */
export function ResultCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-white"
    >
      <div className="aspect-[16/10] w-full flex-none animate-pulse bg-cream motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="h-5 w-3/4 animate-pulse rounded bg-border-soft motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-cream motion-reduce:animate-none" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-cream motion-reduce:animate-none" />
        <div className="mt-auto flex gap-2 pt-2">
          <div className="h-9 w-24 animate-pulse rounded-full bg-cream motion-reduce:animate-none" />
          <div className="h-9 w-24 animate-pulse rounded-full bg-cream motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
