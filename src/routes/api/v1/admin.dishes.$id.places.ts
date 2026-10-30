import { createFileRoute } from "@tanstack/react-router";

import { handleAdminLinkDishPlace } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/places")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        appRuntime.runPromise(handleAdminLinkDishPlace(request, { id: params.id })),
    },
  },
});
