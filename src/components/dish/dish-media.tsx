import { ImageIcon } from "lucide-react";
import { useId, useState } from "react";

import type { PublishedDishImage } from "@/modules/food-discovery/server/operations/dish-media-service";

export const DISH_MEDIA_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

export function DishMediaSkeleton({ label }: { readonly label: string }): React.ReactNode {
  return (
    <output
      aria-label={label}
      className="absolute inset-0 block animate-pulse bg-gradient-to-br from-cream via-border-soft to-cream"
    />
  );
}

export function DishMediaFallback({ label }: { readonly label: string }): React.ReactNode {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-cream to-border-soft text-food-orange-dark"
    >
      <ImageIcon aria-hidden="true" className="size-8" />
      <span className="px-2 text-center text-xs font-semibold">{label}</span>
    </span>
  );
}

/**
 * Single place owning responsive dish-photo rendering. The skeleton shows
 * until the image decodes (metadata arrival never counts as ready), then a
 * short opacity transition reveals it; failures render the branded fallback
 * with no retry loop. Containers reserve aspect up front so cards never
 * jump, and focal points drive object-position without destructive crops.
 */
export function DishMedia({
  image,
  sizes = DISH_MEDIA_SIZES,
  eager = false,
  className = "",
  unavailableLabel = "Photo unavailable",
  loadingLabel = "Loading photo",
}: {
  readonly image: PublishedDishImage | null;
  readonly sizes?: string;
  readonly eager?: boolean;
  readonly className?: string;
  readonly unavailableLabel?: string;
  readonly loadingLabel?: string;
}): React.ReactNode {
  const figureId = useId();
  const [decoded, setDecoded] = useState(false);
  const [failed, setFailed] = useState(false);

  const aspect =
    image !== null && image.width !== null && image.height !== null && image.height > 0
      ? `${image.width} / ${image.height}`
      : "4 / 3";

  return (
    <figure
      aria-labelledby={figureId}
      className={`relative min-w-0 overflow-hidden bg-cream ${className}`}
      style={{ aspectRatio: aspect }}
    >
      <span id={figureId} className="sr-only">
        {image?.alt ?? unavailableLabel}
      </span>
      {image === null || failed || image.url.length === 0 ? (
        <DishMediaFallback label={image?.alt ?? unavailableLabel} />
      ) : (
        <>
          {decoded ? null : <DishMediaSkeleton label={loadingLabel} />}
          <img
            src={image.url}
            srcSet={image.srcSet ?? undefined}
            sizes={image.srcSet === null ? undefined : sizes}
            alt=""
            aria-hidden="true"
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={eager ? "high" : "auto"}
            draggable={false}
            ref={(node) => {
              // Cached (or already-failed) images settle before React
              // attaches listeners; without this mount check they stay
              // invisible behind the skeleton.
              if (node !== null && node.complete) {
                if (node.naturalWidth > 0) {
                  setDecoded(true);
                } else {
                  setFailed(true);
                }
              }
            }}
            onLoad={(event) => {
              if (event.currentTarget.naturalWidth > 0) {
                setDecoded(true);
              } else {
                setFailed(true);
              }
            }}
            onError={() => {
              setFailed(true);
            }}
            style={
              image.focalX !== null && image.focalY !== null
                ? { objectPosition: `${image.focalX * 100}% ${image.focalY * 100}%` }
                : undefined
            }
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
              decoded ? "opacity-100" : "opacity-0"
            }`}
          />
        </>
      )}
    </figure>
  );
}
