import { createFileRoute } from "@tanstack/react-router";

import { handleCuisines } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/cuisines")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleCuisines(request)),
    },
  },
});
