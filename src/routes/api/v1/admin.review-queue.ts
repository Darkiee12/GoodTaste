import { createFileRoute } from "@tanstack/react-router";

import { handleAdminReviewQueue } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/review-queue")({
  server: {
    handlers: {
      GET: ({ request }) => appRuntime.runPromise(handleAdminReviewQueue(request)),
    },
  },
});
