import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

/**
 * Feast Lab shell: the capability-gated sections already live in the
 * primary navbar (`__root.tsx`, driven by the shared `adminNavEntries`
 * source of truth in components/admin/ui), so this shell renders no second
 * nav bar — just the workspace container and the active section. Every
 * admin route still enforces its own server authorization; the menu is
 * never a security boundary.
 */
function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <Outlet />
    </div>
  );
}
