import { createFileRoute } from "@tanstack/react-router";

import { handleHealthReady } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/health/ready")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleHealthReady(request)),
    },
  },
});
