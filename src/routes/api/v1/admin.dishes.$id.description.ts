import { createFileRoute } from "@tanstack/react-router";

import { handleAdminUpsertDishDescription } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/description")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        appRuntime.runPromise(handleAdminUpsertDishDescription(request, { id: params.id })),
    },
  },
});
