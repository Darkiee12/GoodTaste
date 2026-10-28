import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useId, useState } from "react";

import {
  adminAssignRoleFn,
  adminBanUserFn,
  adminListRolesFn,
  adminListUsersFn,
  adminRemoveRoleFn,
  adminUnbanUserFn,
  authorizeFn,
} from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
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
  const pageId = useId();
  const errorId = `${pageId}-error`;
  const [users, setUsers] = useState(initial.users);
  const [assignTarget, setAssignTarget] = useState<ReadonlyMap<string, string>>(new Map());
  const [banTarget, setBanTarget] = useState<string | null>(null);

  const refreshUsers = useMutation({
    mutationFn: () => adminListUsersFn({ data: { limit: 50, offset: 0 } }),
    onSuccess: (rows) => {
      setUsers(rows);
    },
  });

  const assignRole = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      adminAssignRoleFn({ data: { user_id: input.userId, role_id: input.roleId } }),
    onSuccess: (_data, input) => {
      setAssignTarget((prev) => {
        const next = new Map(prev);

        next.delete(input.userId);

        return next;
      });
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
      setBanTarget(null);
      refreshUsers.mutate();
    },
  });

  const unbanUser = useMutation({
    mutationFn: (userId: string) => adminUnbanUserFn({ data: { user_id: userId } }),
    onSuccess: () => {
      refreshUsers.mutate();
    },
  });

  const failed =
    assignRole.isError ||
    removeRole.isError ||
    banUser.isError ||
    unbanUser.isError ||
    refreshUsers.isError;

  const banEntry = users.find((entry) => entry.id === banTarget) ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="font-display text-4xl tracking-wide">{copy.authAdminUsers}</h1>
      {failed ? (
        <div
          role="alert"
          id={errorId}
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>{copy.adminActionFailed}</p>
          <button
            type="button"
            className="mt-2 font-medium underline hover:no-underline"
            onClick={() => {
              assignRole.reset();
              removeRole.reset();
              banUser.reset();
              unbanUser.reset();
              refreshUsers.reset();
              refreshUsers.mutate();
            }}
          >
            {copy.adminRefresh}
          </button>
        </div>
      ) : null}
      {users.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border-soft bg-white p-6 text-sm text-muted shadow-sm">
          {copy.adminNoResults}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {users.map((entry) => {
            const selectId = `${pageId}-assign-${entry.id}`;
            const selectedRole = assignTarget.get(entry.id) ?? "";

            return (
              <li
                key={entry.id}
                className="min-w-0 rounded-lg border border-border-soft bg-white p-4 shadow-sm"
              >
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold">{entry.email}</span>
                  {entry.banned ? (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                      {copy.authSuspended}
                    </span>
                  ) : null}
                </p>
                {entry.roles.length > 0 ? (
                  <ul className="mt-3 grid gap-1.5">
                    {entry.roles.map((roleId) => (
                      <li
                        key={roleId}
                        className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft px-3 py-1.5"
                      >
                        <span className="min-w-0 break-words text-sm">{roleId}</span>
                        <button
                          type="button"
                          disabled={removeRole.isPending}
                          aria-busy={removeRole.isPending}
                          onClick={() => {
                            removeRole.mutate({ userId: entry.id, roleId });
                          }}
                          className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-3 py-1 text-xs font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                        >
                          {copy.authRoleRemove}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3">
                  <label htmlFor={selectId} className="block text-sm font-medium">
                    {copy.authAssignRole}
                  </label>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-2">
                    <select
                      id={selectId}
                      aria-label={`${copy.authAssignRole} ${entry.email}`}
                      value={selectedRole}
                      onChange={(event) => {
                        const next = event.target.value;

                        setAssignTarget((prev) => new Map(prev).set(entry.id, next));
                      }}
                      className="min-w-0 flex-1 rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink motion-safe:transition-colors focus:border-brand-blue"
                    >
                      <option value="">{copy.authAssignRole}</option>
                      {initial.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={assignRole.isPending || selectedRole === ""}
                      aria-busy={assignRole.isPending}
                      onClick={() => {
                        if (selectedRole !== "") {
                          assignRole.mutate({ userId: entry.id, roleId: selectedRole });
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                    >
                      {copy.authAssign}
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  {entry.banned ? (
                    <button
                      type="button"
                      disabled={unbanUser.isPending}
                      aria-busy={unbanUser.isPending}
                      onClick={() => {
                        unbanUser.mutate(entry.id);
                      }}
                      className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-4 py-2 text-sm font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                    >
                      {copy.authUnban}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={banUser.isPending}
                      aria-busy={banUser.isPending}
                      onClick={() => {
                        setBanTarget(entry.id);
                      }}
                      className="inline-flex items-center justify-center rounded-md border border-red-700 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                    >
                      {copy.authBan}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {banEntry !== null ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>
            {copy.adminBanConfirm} <span className="break-words font-medium">{banEntry.email}</span>
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={banUser.isPending}
              onClick={() => {
                banUser.mutate(banEntry.id);
              }}
              className="inline-flex items-center justify-center rounded-md bg-brand-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {copy.commonConfirm}
            </button>
            <button
              type="button"
              onClick={() => {
                setBanTarget(null);
              }}
              className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-3 py-1.5 text-sm font-medium hover:bg-cream motion-safe:transition-colors"
            >
              {copy.commonCancel}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
