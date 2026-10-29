import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useId, useState } from "react";

import {
  adminCreateRoleFn,
  adminDeleteRoleFn,
  adminListRolesFn,
  adminListUsersFn,
  adminSetRoleGrantsFn,
  adminUpdateRoleFn,
  authorizeFn,
} from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

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

const groupVocabulary = (
  keys: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const mutable = new Map<string, Array<string>>();

  for (const key of keys) {
    const [domain] = key.split(":");

    if (domain === undefined) {
      continue;
    }

    const list = mutable.get(domain);

    if (list === undefined) {
      mutable.set(domain, [key]);
    } else {
      list.push(key);
    }
  }

  return mutable;
};

const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink motion-safe:transition-colors focus:border-brand-blue";

function AdminRoles() {
  const initial = Route.useLoaderData();
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const pageId = useId();
  const createErrorId = `${pageId}-create-error`;
  const listErrorId = `${pageId}-list-error`;
  const [roles, setRoles] = useState(initial.roles);
  const [users, setUsers] = useState(initial.users);
  const [vocabulary] = useState(initial.vocabulary);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, RoleDraft>>(new Map());

  const [grantSelections, setGrantSelections] = useState<
    ReadonlyMap<string, ReadonlyArray<string>>
  >(new Map());

  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const refreshCatalog = useMutation({
    mutationFn: async () => {
      const [catalog, list] = await Promise.all([
        adminListRolesFn(),
        adminListUsersFn({ data: { limit: 200, offset: 0 } }),
      ]);

      return { catalog, list };
    },
    onSuccess: ({ catalog, list }) => {
      setRoles(catalog.roles);
      setUsers(list);
      setDrafts(new Map());
      setGrantSelections(new Map());
    },
  });

  const memberCount = (roleId: string): number =>
    users.filter((user) => user.roles.includes(roleId)).length;

  const groups = groupVocabulary(vocabulary);

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
      refreshCatalog.mutate();
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
      refreshCatalog.mutate();
    },
  });

  const setGrants = useMutation({
    mutationFn: (input: { roleId: string; permissions: ReadonlyArray<string> }) =>
      adminSetRoleGrantsFn({
        data: { role_id: input.roleId, permissions: [...input.permissions] },
      }),
    onSuccess: () => {
      refreshCatalog.mutate();
    },
  });

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => adminDeleteRoleFn({ data: { role_id: roleId } }),
    onSuccess: () => {
      setDeleteTarget(null);
      refreshCatalog.mutate();
    },
  });

  const updateDraft = (roleId: string, fallback: RoleDraft, patch: Partial<RoleDraft>): void => {
    setDrafts((prev) => new Map(prev).set(roleId, { ...fallback, ...patch }));
  };

  const toggleGrant = (roleId: string, fallback: ReadonlyArray<string>, key: string): void => {
    const current = grantSelections.get(roleId) ?? fallback;

    const next = current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key];

    setGrantSelections((prev) => new Map(prev).set(roleId, next));
  };

  const listFailed =
    updateRole.isError || setGrants.isError || deleteRole.isError || refreshCatalog.isError;

  const deleteEntry = roles.find((role) => role.id === deleteTarget) ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="font-display text-4xl tracking-wide">{copy.authRoles}</h1>
      <section
        aria-labelledby={`${pageId}-create-heading`}
        className="mt-4 rounded-lg border border-border-soft bg-white p-4 shadow-sm"
      >
        <h2 id={`${pageId}-create-heading`} className="font-display text-2xl tracking-wide">
          {copy.authRoleCreate}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${pageId}-new-slug`} className="block text-sm font-medium">
              {copy.authRoleSlug}
            </label>
            <input
              id={`${pageId}-new-slug`}
              name="newSlug"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={newSlug}
              onChange={(event) => {
                setNewSlug(event.target.value);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${pageId}-new-name`} className="block text-sm font-medium">
              {copy.authRoleName}
            </label>
            <input
              id={`${pageId}-new-name`}
              name="newName"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
              }}
              className={inputClass}
            />
          </div>
        </div>
        {createRole.isError ? (
          <div
            role="alert"
            id={createErrorId}
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <p>{copy.adminRoleCreateFailed}</p>
            <button
              type="button"
              className="mt-2 font-medium underline hover:no-underline"
              onClick={() => {
                createRole.reset();
              }}
            >
              {copy.commonRetry}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          disabled={createRole.isPending || newSlug.trim() === ""}
          aria-busy={createRole.isPending}
          aria-describedby={createRole.isError ? createErrorId : undefined}
          onClick={() => {
            createRole.mutate();
          }}
          className="mt-3 inline-flex items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
        >
          {copy.authCreate}
        </button>
      </section>
      {listFailed ? (
        <div
          role="alert"
          id={listErrorId}
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>{copy.adminActionFailed}</p>
          <button
            type="button"
            className="mt-2 font-medium underline hover:no-underline"
            onClick={() => {
              updateRole.reset();
              setGrants.reset();
              deleteRole.reset();
              refreshCatalog.reset();
              refreshCatalog.mutate();
            }}
          >
            {copy.adminRefresh}
          </button>
        </div>
      ) : null}
      {roles.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border-soft bg-white p-6 text-sm text-muted shadow-sm">
          {copy.adminNoResults}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {roles.map((role) => {
            const draft = drafts.get(role.id) ?? draftOf(role);
            const selected = grantSelections.get(role.id) ?? role.permissions;

            return (
              <li
                key={role.id}
                className="min-w-0 rounded-lg border border-border-soft bg-white p-4 shadow-sm"
              >
                <h3 className="min-w-0 break-words font-display text-2xl tracking-wide">
                  {role.name} <span className="text-lg text-muted">({role.slug})</span>
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {role.isSystem ? copy.authRoleSystem : copy.authRoleCustom}
                  {role.isProtected ? `, ${copy.authRoleProtected}` : null} · {memberCount(role.id)}{" "}
                  {copy.authRoleMembers} · {role.permissions.length} {copy.authRoleGrants}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${pageId}-name-${role.id}`}
                      className="block text-sm font-medium"
                    >
                      {copy.authRoleName}
                    </label>
                    <input
                      id={`${pageId}-name-${role.id}`}
                      name={`roleName-${role.slug}`}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={draft.name}
                      onChange={(event) => {
                        updateDraft(role.id, draft, { name: event.target.value });
                      }}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${pageId}-description-${role.id}`}
                      className="block text-sm font-medium"
                    >
                      {copy.authRoleDescription}
                    </label>
                    <input
                      id={`${pageId}-description-${role.id}`}
                      name={`roleDescription-${role.slug}`}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={draft.description}
                      onChange={(event) => {
                        updateDraft(role.id, draft, { description: event.target.value });
                      }}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${pageId}-color-${role.id}`}
                      className="block text-sm font-medium"
                    >
                      {copy.authRoleColor}
                    </label>
                    <input
                      id={`${pageId}-color-${role.id}`}
                      name={`roleColor-${role.slug}`}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={draft.color}
                      onChange={(event) => {
                        updateDraft(role.id, draft, { color: event.target.value });
                      }}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${pageId}-position-${role.id}`}
                      className="block text-sm font-medium"
                    >
                      {copy.authRolePosition}
                    </label>
                    <input
                      id={`${pageId}-position-${role.id}`}
                      name={`rolePosition-${role.slug}`}
                      type="text"
                      autoComplete="off"
                      inputMode="numeric"
                      value={draft.position}
                      onChange={(event) => {
                        updateDraft(role.id, draft, { position: event.target.value });
                      }}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={updateRole.isPending}
                    aria-busy={updateRole.isPending}
                    onClick={() => {
                      updateRole.mutate({ roleId: role.id, draft, slug: role.slug });
                    }}
                    className="inline-flex items-center justify-center rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                  >
                    {copy.authRoleSave}
                  </button>
                </div>
                {[...groups.entries()].map(([domain, keys]) => (
                  <fieldset
                    key={domain}
                    className="mt-3 rounded-md border border-border-soft px-3 py-2"
                  >
                    <legend className="px-1 font-display text-xl tracking-wide">{domain}</legend>
                    <div className="grid gap-1.5 py-1">
                      {keys.map((key) => (
                        <label key={key} className="flex min-w-0 items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.includes(key)}
                            onChange={() => {
                              toggleGrant(role.id, role.permissions, key);
                            }}
                            className="mt-1 shrink-0"
                          />
                          <span className="min-w-0 break-words">{key}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={setGrants.isPending}
                    aria-busy={setGrants.isPending}
                    onClick={() => {
                      setGrants.mutate({ roleId: role.id, permissions: selected });
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-border-soft bg-white px-4 py-2 text-sm font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                  >
                    {copy.authRoleSaveGrants}
                  </button>
                  <button
                    type="button"
                    disabled={deleteRole.isPending || role.isSystem}
                    title={role.isSystem ? copy.authRoleDeleteForbidden : undefined}
                    onClick={() => {
                      setDeleteTarget(role.id);
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-red-700 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
                  >
                    {copy.authRoleDelete}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {deleteEntry !== null ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>
            {copy.adminDeleteRoleConfirm}{" "}
            <span className="break-words font-medium">{deleteEntry.name}</span>
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={deleteRole.isPending}
              onClick={() => {
                deleteRole.mutate(deleteEntry.id);
              }}
              className="inline-flex items-center justify-center rounded-md bg-brand-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-colors"
            >
              {copy.commonConfirm}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteTarget(null);
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
