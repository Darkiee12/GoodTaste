import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminCreateRoleFn,
  adminDeleteRoleFn,
  adminListRolesFn,
  adminListUsersFn,
  adminSetRoleGrantsFn,
  adminUpdateRoleFn,
  authorizeFn,
  getSessionFn,
} from "@/modules/user/user.functions";

export const Route = createFileRoute("/admin/roles")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/admin/roles", lang: search.lang },
      });
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
    const [catalog, users] = await Promise.all([
      adminListRolesFn(),
      adminListUsersFn({ data: { limit: 200, offset: 0 } }),
    ]);

    return { roles: catalog.roles, vocabulary: catalog.vocabulary, users };
  },
  component: AdminRoles,
});

interface RoleDraft {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly position: string;
}

const draftOf = (role: {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly position: number;
}): RoleDraft => ({
  name: role.name,
  description: role.description,
  color: role.color,
  position: String(role.position),
});

function AdminRoles() {
  const initial = Route.useLoaderData();
  const [roles, setRoles] = useState(initial.roles);
  const [vocabulary] = useState(initial.vocabulary);
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [grantSelections, setGrantSelections] = useState<Record<string, ReadonlyArray<string>>>({});
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  const refreshRoles = useMutation({
    mutationFn: () => adminListRolesFn(),
    onSuccess: (catalog) => {
      setRoles(catalog.roles);
      setDrafts({});
      setGrantSelections({});
    },
  });

  const memberCount = (roleId: string): number =>
    initial.users.filter((user) => user.roles.includes(roleId)).length;

  const groups = vocabulary.reduce<Record<string, Array<string>>>((acc, key) => {
    const [domain] = key.split(":");

    if (domain !== undefined) {
      acc[domain] = [...(acc[domain] ?? []), key];
    }

    return acc;
  }, {});

  const createRole = useMutation({
    mutationFn: () =>
      adminCreateRoleFn({
        data: {
          slug: newSlug.trim(),
          name: newName.trim() === "" ? newSlug.trim() : newName.trim(),
          description: "",
          color: "#6b7280",
          position: 0,
        },
      }),
    onSuccess: () => {
      setNewSlug("");
      setNewName("");
      refreshRoles.mutate();
    },
  });

  const updateRole = useMutation({
    mutationFn: (input: { roleId: string; draft: RoleDraft; slug: string }) =>
      adminUpdateRoleFn({
        data: {
          role_id: input.roleId,
          slug: input.slug,
          name: input.draft.name,
          description: input.draft.description,
          color: input.draft.color,
          position: Number.parseInt(input.draft.position, 10) || 0,
        },
      }),
    onSuccess: () => {
      refreshRoles.mutate();
    },
  });

  const setGrants = useMutation({
    mutationFn: (input: { roleId: string; permissions: ReadonlyArray<string> }) =>
      adminSetRoleGrantsFn({
        data: { role_id: input.roleId, permissions: [...input.permissions] },
      }),
    onSuccess: () => {
      refreshRoles.mutate();
    },
  });

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => adminDeleteRoleFn({ data: { role_id: roleId } }),
    onSuccess: () => {
      refreshRoles.mutate();
    },
  });

  const toggleGrant = (roleId: string, fallback: ReadonlyArray<string>, key: string): void => {
    const current = grantSelections[roleId] ?? fallback;

    const next = current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key];

    setGrantSelections({ ...grantSelections, [roleId]: next });
  };

  return (
    <div className="settings">
      <h1>Roles</h1>
      <section>
        <h2>Create role</h2>
        <label>
          Slug
          <input
            value={newSlug}
            onChange={(event) => {
              setNewSlug(event.target.value);
            }}
          />
        </label>
        <label>
          Name
          <input
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          disabled={createRole.isPending || newSlug.trim() === ""}
          onClick={() => {
            createRole.mutate();
          }}
        >
          Create
        </button>
      </section>
      <ul>
        {roles.map((role) => {
          const draft = drafts[role.id] ?? draftOf(role);
          const selected = grantSelections[role.id] ?? role.permissions;

          return (
            <li key={role.id}>
              <h3>
                {role.name} <span>({role.slug})</span>
              </h3>
              <p>
                {role.isSystem ? "system" : "custom"}
                {role.isProtected ? ", protected" : null} · {memberCount(role.id)} members ·{" "}
                {role.permissions.length} grants
              </p>
              <label>
                Name
                <input
                  value={draft.name}
                  onChange={(event) => {
                    setDrafts({ ...drafts, [role.id]: { ...draft, name: event.target.value } });
                  }}
                />
              </label>
              <label>
                Description
                <input
                  value={draft.description}
                  onChange={(event) => {
                    setDrafts({
                      ...drafts,
                      [role.id]: { ...draft, description: event.target.value },
                    });
                  }}
                />
              </label>
              <label>
                Color
                <input
                  value={draft.color}
                  onChange={(event) => {
                    setDrafts({ ...drafts, [role.id]: { ...draft, color: event.target.value } });
                  }}
                />
              </label>
              <label>
                Position
                <input
                  value={draft.position}
                  inputMode="numeric"
                  onChange={(event) => {
                    setDrafts({
                      ...drafts,
                      [role.id]: { ...draft, position: event.target.value },
                    });
                  }}
                />
              </label>
              <button
                type="button"
                disabled={updateRole.isPending}
                onClick={() => {
                  updateRole.mutate({ roleId: role.id, draft, slug: role.slug });
                }}
              >
                Save
              </button>
              {Object.entries(groups).map(([domain, keys]) => (
                <fieldset key={domain}>
                  <legend>{domain}</legend>
                  {keys.map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={() => {
                          toggleGrant(role.id, role.permissions, key);
                        }}
                      />
                      {key}
                    </label>
                  ))}
                </fieldset>
              ))}
              <button
                type="button"
                disabled={setGrants.isPending}
                onClick={() => {
                  setGrants.mutate({ roleId: role.id, permissions: selected });
                }}
              >
                Save grants
              </button>
              <button
                type="button"
                disabled={deleteRole.isPending || role.isSystem}
                title={
                  role.isSystem ? "System roles cannot be deleted, only unassigned" : undefined
                }
                onClick={() => {
                  deleteRole.mutate(role.id);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
