import { createFileRoute } from "@tanstack/react-router";

import { handleHealthLive } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/health/live")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleHealthLive(request)),
    },
  },
});
