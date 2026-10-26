import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Start creates a router for each request. Never share one across SSR requests.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
