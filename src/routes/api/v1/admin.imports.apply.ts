import { createFileRoute } from "@tanstack/react-router";

import { handleAdminImportApply } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/imports/apply")({
  server: {
    handlers: {
      POST: ({ request }) => appRuntime.runPromise(handleAdminImportApply(request)),
    },
  },
});
