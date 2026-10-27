import { createFileRoute } from "@tanstack/react-router";

import { handleAdminLinkDishCategory } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/categories")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        appRuntime.runPromise(handleAdminLinkDishCategory(request, { id: params.id })),
    },
  },
});
