import { createFileRoute } from "@tanstack/react-router";

import { handlePlaceDetail } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/places/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handlePlaceDetail(request, { id: params.id })),
    },
  },
});
