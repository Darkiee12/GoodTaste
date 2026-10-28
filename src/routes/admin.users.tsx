import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminAssignRoleFn,
  adminBanUserFn,
  adminListRolesFn,
  adminListUsersFn,
  adminRemoveRoleFn,
  adminUnbanUserFn,
  authorizeFn,
  getSessionFn,
} from "@/modules/user/user.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/admin/users")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin/users", lang: search.lang } });
    }

    const { allowed } = await authorizeFn({
      data: { checks: [{ resource: "admin", actions: ["access"] }] },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async () => {
    const [users, roleCatalog] = await Promise.all([
      adminListUsersFn({ data: { limit: 50, offset: 0 } }),
      adminListRolesFn(),
    ]);

    return { users, roles: roleCatalog.roles };
  },
  component: AdminUsers,
});

function AdminUsers() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const initial = Route.useLoaderData();
  const [users, setUsers] = useState(initial.users);
  const [assignTarget, setAssignTarget] = useState<Record<string, string>>({});

  const refreshUsers = useMutation({
    mutationFn: () => adminListUsersFn({ data: { limit: 50, offset: 0 } }),
    onSuccess: (rows) => {
      setUsers(rows);
    },
  });

  const assignRole = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      adminAssignRoleFn({ data: { user_id: input.userId, role_id: input.roleId } }),
    onSuccess: () => {
      refreshUsers.mutate();
    },
  });

  const removeRole = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      adminRemoveRoleFn({ data: { user_id: input.userId, role_id: input.roleId } }),
    onSuccess: () => {
      refreshUsers.mutate();
    },
  });

  const banUser = useMutation({
    mutationFn: (userId: string) => adminBanUserFn({ data: { user_id: userId, reason: "" } }),
    onSuccess: () => {
      refreshUsers.mutate();
    },
  });

  const unbanUser = useMutation({
    mutationFn: (userId: string) => adminUnbanUserFn({ data: { user_id: userId } }),
    onSuccess: () => {
      refreshUsers.mutate();
    },
  });

  return (
    <div className="settings">
      <h1>{copy.authAdminUsers}</h1>
      <ul>
        {users.map((entry) => (
          <li key={entry.id}>
            <span>
              {entry.email}
              {entry.banned ? " [suspended]" : null}
            </span>
            <ul>
              {entry.roles.map((roleId) => (
                <li key={roleId}>
                  {roleId}
                  <button
                    type="button"
                    disabled={removeRole.isPending}
                    onClick={() => {
                      removeRole.mutate({ userId: entry.id, roleId });
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <select
              value={assignTarget[entry.id] ?? ""}
              onChange={(event) => {
                setAssignTarget({ ...assignTarget, [entry.id]: event.target.value });
              }}
            >
              <option value="">Assign role…</option>
              {initial.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={assignRole.isPending || (assignTarget[entry.id] ?? "") === ""}
              onClick={() => {
                const roleId = assignTarget[entry.id];

                if (roleId !== undefined && roleId !== "") {
                  assignRole.mutate({ userId: entry.id, roleId });
                }
              }}
            >
              Assign
            </button>
            {entry.banned ? (
              <button
                type="button"
                disabled={unbanUser.isPending}
                onClick={() => {
                  unbanUser.mutate(entry.id);
                }}
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                disabled={banUser.isPending}
                onClick={() => {
                  banUser.mutate(entry.id);
                }}
              >
                Suspend
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
