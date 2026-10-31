import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DiscoveryError } from "@/modules/restaurant-discovery/components/discovery-error";
import { RestaurantDetailPage } from "@/modules/restaurant-discovery/components/restaurant-detail-page";
import { getRestaurantFn } from "@/modules/restaurant-discovery/restaurant.functions";
import { channelSchema } from "@/modules/restaurant-discovery/restaurant.schema";

export const Route = createFileRoute("/restaurants/$venueId")({
  // Carried from the main-track worktree (dish → venue → dish back-links).
  // Owner sign-off still needed.
  validateSearch: z.object({
    channel: channelSchema.default("dine_in"),
    variant: z.uuid().optional(),
    dish: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .optional(),
    fromDish: z.string().min(1).max(120).optional(),
  }),
  loaderDeps: ({ search }) => ({ channel: search.channel }),
  loader: ({ params, deps }) =>
    getRestaurantFn({ data: { venueId: params.venueId, channel: deps.channel } }),
  errorComponent: DiscoveryError,
  component: RestaurantDetailPage,
});
