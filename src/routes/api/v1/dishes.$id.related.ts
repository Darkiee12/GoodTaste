import { createFileRoute } from "@tanstack/react-router";

import { handleDishRelated } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/dishes/$id/related")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handleDishRelated(request, { id: params.id })),
    },
  },
});
