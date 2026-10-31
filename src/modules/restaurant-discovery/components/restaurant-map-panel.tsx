import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const RestaurantMap = lazy(
  () => import("@/modules/restaurant-discovery/components/restaurant-map"),
);

export function RestaurantMapPanel(props: ComponentProps<typeof RestaurantMap>) {
  const fallback = (
    <div className="discovery-map-fallback" aria-live="polite">
      Loading map. Restaurant names and addresses are available in the list.
    </div>
  );

  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <RestaurantMap {...props} />
      </Suspense>
    </ClientOnly>
  );
}
