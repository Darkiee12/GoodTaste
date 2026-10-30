import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { RoleEntry, RolesCapabilities } from "@/components/admin/roles/role-types";

export interface RoleNavigatorStrings {
  readonly heading: string;
  readonly createRole: string;
  readonly system: string;
  readonly custom: string;
  readonly protectedBadge: string;
  readonly members: string;
  readonly unsaved: string;
}

/**
 * Discord-style role navigator: compact header (title + count + create),
 * scrollable position-ordered rows with color dot, name, member count, and
 * state badges. No inline editing — selection only.
 */
export function RoleNavigator({
  roles,
  counts,
  activeRoleId,
  dirtyRoleIds,
  disabled,
  capabilities,
  strings,
  onSelect,
  onCreate,
}: {
  readonly roles: ReadonlyArray<RoleEntry>;
  readonly counts: ReadonlyMap<string, number>;
  readonly activeRoleId: string | null;
  readonly dirtyRoleIds: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly capabilities?: RolesCapabilities;
  readonly strings: RoleNavigatorStrings;
  readonly onSelect: (roleId: string) => void;
  readonly onCreate: () => void;
}): ReactNode {
  const canCreate = capabilities?.canCreate ?? false;
  const ordered = roles.toSorted((a, b) => a.position - b.position);

  return (
    <nav
      aria-label={strings.heading}
      className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-border-soft bg-white"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 py-2.5">
        <h2 className="truncate text-sm font-bold tracking-wide text-ink uppercase">
          {strings.heading} · {ordered.length}
        </h2>
        {canCreate ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onCreate}
            aria-label={strings.createRole}
            title={strings.createRole}
            className="inline-flex min-h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      <ul className="max-h-[62dvh] min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 md:max-h-none">
        {ordered.map((role) => {
          const active = role.id === activeRoleId;
          const dirty = dirtyRoleIds.has(role.id);
          const memberCount = counts.get(role.id) ?? 0;

          return (
            <li key={role.id}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? "true" : undefined}
                aria-label={`${role.name}, ${role.isSystem ? strings.system : strings.custom}${
                  role.isProtected ? `, ${strings.protectedBadge}` : ""
                }, ${memberCount} ${strings.members}${dirty ? `, ${strings.unsaved}` : ""}`}
                onClick={() => {
                  onSelect(role.id);
                }}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                  active ? "bg-brand-blue/10" : "hover:bg-cream"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span
                  aria-hidden="true"
                  className="size-3.5 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: role.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {role.name}
                    {dirty ? (
                      <span className="ml-1.5 inline-block size-1.5 rounded-full bg-food-orange-dark align-middle" />
                    ) : null}
                    <span className="sr-only">{dirty ? ` (${strings.unsaved})` : ""}</span>
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {role.isSystem ? strings.system : strings.custom}
                    {role.isProtected ? ` · ${strings.protectedBadge}` : null} · {memberCount}{" "}
                    {strings.members}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
