import { Link, Outlet, createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";

import { adminSurfaceFn } from "@/modules/food-discovery/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin", lang: search.lang } });
    }

    const { allowed } = await adminSurfaceFn();

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  component: AdminLayout,
});

type AdminNavTarget =
  | "/admin"
  | "/admin/restaurants"
  | "/admin/dishes"
  | "/admin/imports"
  | "/admin/reviews"
  | "/admin/users"
  | "/admin/roles";

function AdminLayout() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  const links: ReadonlyArray<{ readonly to: AdminNavTarget; readonly label: string }> = [
    { to: "/admin", label: copy.adminDashboard },
    { to: "/admin/restaurants", label: "Restaurants & menus" },
    { to: "/admin/dishes", label: copy.adminDishes },
    { to: "/admin/imports", label: copy.adminImports },
    { to: "/admin/reviews", label: copy.adminReviews },
    { to: "/admin/users", label: copy.adminMembers },
    { to: "/admin/roles", label: copy.adminRoles },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:flex-row md:items-start">
      <div className="bg-ocean-deep rounded-2xl p-3 text-white md:sticky md:top-20 md:w-60 md:shrink-0">
        <p className="text-mango px-2 pt-1 pb-2 text-sm font-bold tracking-wide">
          {copy.adminWorkspace}
        </p>
        <nav aria-label={copy.adminWorkspace}>
          <ul className="flex flex-row gap-1 overflow-x-auto pb-[env(safe-area-inset-bottom)] md:flex-col md:overflow-visible md:pb-0">
            {links.map((entry) => (
              <li key={entry.to} className="shrink-0">
                <Link
                  to={entry.to}
                  search={{ lang }}
                  activeOptions={{ exact: entry.to === "/admin" }}
                  activeProps={{ "aria-current": "page" }}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap text-white/80 hover:bg-white/10 hover:text-white aria-current:bg-white/15 aria-current:text-white"
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
