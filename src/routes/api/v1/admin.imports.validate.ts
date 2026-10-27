import { createFileRoute } from "@tanstack/react-router";

import { handleAdminImportValidate } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/imports/validate")({
  server: {
    handlers: {
      POST: ({ request }) => appRuntime.runPromise(handleAdminImportValidate(request)),
    },
  },
});
