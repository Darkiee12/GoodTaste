import type { adminListRolesFn } from "@/modules/user/admin.functions";

export type RoleEntry = Awaited<ReturnType<typeof adminListRolesFn>>["roles"][number];

/**
 * Mutation grants for the Roles workspace. Agent R2 owns the exact prop
 * contract; every field is optional and defaults to read-only-safe
 * (`false`) so the editor can never enable a mutation it was not granted.
 */
export interface RolesCapabilities {
  readonly canCreate?: boolean;
  readonly canUpdate?: boolean;
  readonly canManagePermissions?: boolean;
  readonly canDelete?: boolean;
}

/** Editable copy of one role's metadata plus its grant selection. */
export interface RoleDraft {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly position: string;
  readonly permissions: ReadonlyArray<string>;
}

export const draftOf = (role: RoleEntry): RoleDraft => ({
  name: role.name,
  description: role.description,
  color: role.color,
  position: String(role.position),
  permissions: [...role.permissions],
});

export const draftsEqual = (a: RoleDraft, b: RoleDraft): boolean =>
  a.name === b.name &&
  a.description === b.description &&
  a.color.toLowerCase() === b.color.toLowerCase() &&
  a.position === b.position &&
  a.permissions.length === b.permissions.length &&
  a.permissions.every((permission) => b.permissions.includes(permission));
