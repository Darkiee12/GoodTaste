import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/server/auth/better-auth";

/**
 * Better Auth request handler. All `/api/auth/*` endpoints (sign-in,
 * sign-up, callbacks, session, admin) dispatch through `auth.handler`.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => auth.handler(request),
      POST: ({ request }: { request: Request }) => auth.handler(request),
    },
  },
});
