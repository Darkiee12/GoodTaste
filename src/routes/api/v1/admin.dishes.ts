import { createFileRoute } from "@tanstack/react-router";

import { handleAdminCreateDish } from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes")({
  server: {
    handlers: {
      POST: ({ request }) => appRuntime.runPromise(handleAdminCreateDish(request)),
    },
  },
});
