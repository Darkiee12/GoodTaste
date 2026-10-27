import { createFileRoute } from "@tanstack/react-router";

import { handleAdminLinkDishCuisine } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/cuisines")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        appRuntime.runPromise(handleAdminLinkDishCuisine(request, { id: params.id })),
    },
  },
});
