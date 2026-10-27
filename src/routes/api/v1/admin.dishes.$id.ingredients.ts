import { createFileRoute } from "@tanstack/react-router";

import { handleAdminLinkDishIngredient } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/ingredients")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        appRuntime.runPromise(handleAdminLinkDishIngredient(request, { id: params.id })),
    },
  },
});
