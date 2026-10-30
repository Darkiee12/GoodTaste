import { createFileRoute } from "@tanstack/react-router";

import { handlePlaceList } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/places")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handlePlaceList(request)),
    },
  },
});
