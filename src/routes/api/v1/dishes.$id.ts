import { createFileRoute } from "@tanstack/react-router";

import { handleDishDetail } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/dishes/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handleDishDetail(request, { id: params.id })),
    },
  },
});
