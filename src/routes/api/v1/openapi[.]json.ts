import { createFileRoute } from "@tanstack/react-router";

import { handleOpenApi } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleOpenApi(request)),
    },
  },
});
