import { createFileRoute } from "@tanstack/react-router";

import { handleAdminUpdateDish } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        appRuntime.runPromise(handleAdminUpdateDish(request, { id: params.id })),
    },
  },
});
