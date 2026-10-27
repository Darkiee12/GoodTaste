import { createFileRoute } from "@tanstack/react-router";

import { handleAdminListRevisions } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/revisions")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        appRuntime.runPromise(handleAdminListRevisions(request, { id: params.id })),
    },
  },
});
