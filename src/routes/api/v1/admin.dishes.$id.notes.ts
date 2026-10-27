import { createFileRoute } from "@tanstack/react-router";

import {
  handleAdminAddNote,
  handleAdminListNotes,
} from "@/modules/food-discovery/server/api-adapter";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/admin/dishes/$id/notes")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        appRuntime.runPromise(handleAdminAddNote(request, { id: params.id })),
      GET: ({ request, params }) =>
        appRuntime.runPromise(handleAdminListNotes(request, { id: params.id })),
    },
  },
});
