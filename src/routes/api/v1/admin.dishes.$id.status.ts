import { createFileRoute } from "@tanstack/react-router";

import { handleAdminUpdateDishStatus } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/status")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        appRuntime.runPromise(handleAdminUpdateDishStatus(request, { id: params.id })),
    },
  },
});
