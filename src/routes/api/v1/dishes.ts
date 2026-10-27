import { createFileRoute } from "@tanstack/react-router";

import { handleDishSearch } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/dishes")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleDishSearch(request)),
    },
  },
});
