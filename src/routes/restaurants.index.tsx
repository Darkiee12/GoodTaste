import { createFileRoute } from "@tanstack/react-router";

import { DiscoveryError } from "@/modules/restaurant-discovery/components/discovery-error";
import { RestaurantSearchPage } from "@/modules/restaurant-discovery/components/restaurant-search-page";
import {
  restaurantAreasFn,
  restaurantFacetsFn,
  searchRestaurantsFn,
} from "@/modules/restaurant-discovery/restaurant.functions";
import { restaurantSearchSchema } from "@/modules/restaurant-discovery/restaurant.schema";

export const Route = createFileRoute("/restaurants/")({
  validateSearch: restaurantSearchSchema,
  loaderDeps: ({ search }) => restaurantSearchSchema.parse(search),
  loader: async ({ deps }) => {
    const [results, areas, cuisines] = await Promise.all([
      searchRestaurantsFn({ data: deps }),
      restaurantAreasFn(),
      restaurantFacetsFn(),
    ]);

    return { results, areas, cuisines };
  },
  pendingComponent: () => (
    <div className="discovery-empty" aria-live="polite">
      Finding sourced restaurant records…
    </div>
  ),
  errorComponent: DiscoveryError,
  component: RestaurantSearchPage,
});
