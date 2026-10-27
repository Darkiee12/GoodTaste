import { createFileRoute } from "@tanstack/react-router";

import { handleCategories } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/categories")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleCategories(request)),
    },
  },
});
