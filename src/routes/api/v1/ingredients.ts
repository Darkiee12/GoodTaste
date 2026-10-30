import { createFileRoute } from "@tanstack/react-router";

import { handleIngredientSearch } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/ingredients")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleIngredientSearch(request)),
    },
  },
});
