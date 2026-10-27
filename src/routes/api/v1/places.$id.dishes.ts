import { createFileRoute } from "@tanstack/react-router";

import { handlePlaceDishes } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/places/$id/dishes")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handlePlaceDishes(request, { id: params.id })),
    },
  },
});
