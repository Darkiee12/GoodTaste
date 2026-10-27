import { createFileRoute } from "@tanstack/react-router";

import { handleIngredientDetail } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/ingredients/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handleIngredientDetail(request, { id: params.id })),
    },
  },
});
