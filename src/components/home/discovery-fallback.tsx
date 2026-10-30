import { Globe2Icon, TriangleAlertIcon, UtensilsCrossedIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DishCarouselSkeleton } from "@/components/dish/dish-carousel";
import type { Messages } from "@/shared/i18n";

/**
 * Result presentation shell for the homepage discovery carousel. Owns every
 * non-carousel state so the section never collapses to a bare paragraph:
 * loading reuses the shared skeleton, failures get a distinct error panel
 * with retry, and empty results get an illustrated panel sized to the
 * carousel footprint. The worldwide fallback itself stays a real
 * `DishCarousel` owned by the caller; this shell only contributes the small
 * subordinate note that keeps worldwide dishes from reading as local.
 *
 * New catalog copy this shell needs (see report): a worldwide-fallback note
 * and a catalog-empty tagline. Both arrive as optional props defaulting to
 * the approved English direction until `src/shared/i18n.ts` carries them.
 */

export const DISCOVERY_WORLDWIDE_NOTE_FALLBACK =
  "No dishes from this area in our catalog yet. Here are some favorites from around the world.";

export const DISCOVERY_CATALOG_TAGLINE_FALLBACK = "We're still collecting delicious discoveries.";

export type DiscoveryFallbackState =
  | "loading"
  | "error"
  | "unknown"
  | "region-empty"
  | "catalog-empty"
  | "ready";

export interface DiscoveryResultInput {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly located: boolean;
  readonly geoSettled: boolean;
  readonly total: number;
  readonly worldwide: boolean;
  readonly isAutoWorldwide: boolean;
}

/**
 * Pure state resolution for the discovery result area, shared by the shell
 * and the lead integrator. Mirrors the branch order in
 * `discovery-section.tsx`: loading wins, then failure, then any served
 * items, then the unlocated case, then catalog-empty (a worldwide scope
 * that still serves nothing) versus region-empty (a scoped query that
 * serves nothing while worldwide remains untried).
 */
export const resolveDiscoveryFallbackState = (
  input: DiscoveryResultInput,
): DiscoveryFallbackState => {
  if (input.loading) {
    return "loading";
  }

  if (input.failed) {
    return "error";
  }

  if (input.total > 0) {
    return "ready";
  }

  if (!input.located) {
    if (input.geoSettled) {
      return "unknown";
    }

    return "loading";
  }

  if (input.worldwide || input.isAutoWorldwide) {
    return "catalog-empty";
  }

  return "region-empty";
};

const PANEL_FRAME =
  "grid w-full place-items-center overflow-hidden rounded-3xl border border-border-soft bg-white px-6 py-12 shadow-[0_12px_28px_rgba(194,65,12,0.08)] sm:px-8";

const PANEL_BODY =
  "flex min-h-[20rem] w-full max-w-[36rem] flex-col items-center text-center md:min-h-[22rem]";

const MEDALLION = "flex size-16 items-center justify-center rounded-full bg-cream";

export function DiscoveryLoadingState({ copy }: { readonly copy: Messages }): ReactNode {
  return (
    <div>
      <output className="block text-base font-semibold text-muted">
        {copy.discoverLocalLoading}
      </output>
      <div className="mt-4">
        <DishCarouselSkeleton />
      </div>
    </div>
  );
}

export function DiscoveryWorldwideNote({
  copy,
  note,
}: {
  readonly copy: Messages;
  readonly note?: string | undefined;
}): ReactNode {
  return (
    <p className="mb-4 flex items-start gap-2 text-sm font-semibold text-muted">
      <Globe2Icon aria-hidden="true" className="mt-0.5 size-4 flex-none" />
      <span>
        <span className="font-bold text-ink">{copy.carouselWorldwide}</span>
        <span aria-hidden="true"> · </span>
        {note ?? DISCOVERY_WORLDWIDE_NOTE_FALLBACK}
      </span>
    </p>
  );
}

export function DiscoveryErrorPanel({
  copy,
  onRetry,
}: {
  readonly copy: Messages;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div role="alert" className={PANEL_FRAME}>
      <div className={PANEL_BODY}>
        <span className={`${MEDALLION} bg-danger/10`}>
          <TriangleAlertIcon aria-hidden="true" className="size-8 text-danger" />
        </span>
        <p className="mt-5 text-lg font-bold text-ink">{copy.discoverLocalError}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-food-orange-strong px-6 text-sm font-bold text-white transition hover:bg-food-orange-dark"
        >
          {copy.commonRetry}
        </button>
      </div>
    </div>
  );
}

export function DiscoveryUnknownPanel({ copy }: { readonly copy: Messages }): ReactNode {
  return (
    <div className={PANEL_FRAME}>
      <div className={PANEL_BODY}>
        <span className={MEDALLION}>
          <Globe2Icon aria-hidden="true" className="size-8 text-food-orange-strong" />
        </span>
        <p className="mt-5 text-lg font-bold text-ink">{copy.discoverLocalUnknown}</p>
      </div>
    </div>
  );
}

export function DiscoveryRegionEmptyPanel({
  copy,
  onExploreWorldwide,
}: {
  readonly copy: Messages;
  readonly onExploreWorldwide: () => void;
}): ReactNode {
  return (
    <div className={PANEL_FRAME}>
      <div className={PANEL_BODY}>
        <span className={MEDALLION}>
          <UtensilsCrossedIcon aria-hidden="true" className="size-8 text-food-orange-strong" />
        </span>
        <p className="mt-5 text-lg font-bold text-ink">{copy.carouselRegionEmpty}</p>
        <p className="mt-2 text-sm font-semibold text-muted">{copy.carouselWorldwide}</p>
        <button
          type="button"
          onClick={onExploreWorldwide}
          className="mt-6 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink hover:text-white"
        >
          <Globe2Icon aria-hidden="true" className="size-4 flex-none" />
          {copy.carouselExploreWorld}
        </button>
      </div>
    </div>
  );
}

export function DiscoveryCatalogEmptyPanel({
  copy,
  tagline,
}: {
  readonly copy: Messages;
  readonly tagline?: string | undefined;
}): ReactNode {
  return (
    <div className={PANEL_FRAME}>
      <div className={PANEL_BODY}>
        <span className={MEDALLION}>
          <UtensilsCrossedIcon aria-hidden="true" className="size-8 text-food-orange-strong" />
        </span>
        <p className="mt-5 text-lg font-bold text-ink">{copy.discoverLocalEmpty}</p>
        <p className="mt-2 text-sm font-semibold text-muted">
          {tagline ?? DISCOVERY_CATALOG_TAGLINE_FALLBACK}
        </p>
      </div>
    </div>
  );
}

export interface DiscoveryFallbackProps {
  readonly copy: Messages;
  readonly state: DiscoveryFallbackState;
  /** Retry handler for the error panel; required when state is "error". */
  readonly onRetry?: (() => void) | undefined;
  /** Worldwide handler for the region-empty panel; required when state is "region-empty". */
  readonly onExploreWorldwide?: (() => void) | undefined;
  /** Overrides the default worldwide-fallback note (unused by the panels). */
  readonly worldwideNote?: string | undefined;
  /** Overrides the default catalog-empty tagline. */
  readonly emptyTagline?: string | undefined;
}

/**
 * Switch mounting one fallback panel per non-ready state. The "ready" and
 * "loading" states render nothing here: the caller owns the carousel (plus
 * `DiscoveryWorldwideNote` above it for worldwide scopes) and renders
 * `DiscoveryLoadingState` for loading so the skeleton keeps its announced
 * loading region.
 */
export function DiscoveryFallback({
  copy,
  emptyTagline,
  onExploreWorldwide,
  onRetry,
  state,
}: DiscoveryFallbackProps): ReactNode {
  if (state === "loading" || state === "ready") {
    return null;
  }

  if (state === "error") {
    if (onRetry === undefined) {
      return null;
    }

    return <DiscoveryErrorPanel copy={copy} onRetry={onRetry} />;
  }

  if (state === "unknown") {
    return <DiscoveryUnknownPanel copy={copy} />;
  }

  if (state === "region-empty") {
    if (onExploreWorldwide === undefined) {
      return null;
    }

    return <DiscoveryRegionEmptyPanel copy={copy} onExploreWorldwide={onExploreWorldwide} />;
  }

  return <DiscoveryCatalogEmptyPanel copy={copy} tagline={emptyTagline} />;
}
