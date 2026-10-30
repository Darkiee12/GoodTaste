import { isPermissionKey, PERMISSION_KEYS, type Permission } from "@/server/auth/permissions";

/**
 * Display metadata for the static permission vocabulary. The valid key set
 * stays authoritative in `src/server/auth/permissions.ts` (`PERMISSION_KEYS`):
 * this module only maps each key to a UI group, label, and description for
 * the roles administration catalog. Unknown keys can never appear here —
 * the catalog is built from the vocabulary, and the role-management
 * boundary rejects anything else before it could be granted.
 */
export interface PermissionCatalogEntry {
  readonly key: Permission;
  readonly group: string;
  readonly label: string;
  readonly description: string;
}

const GROUP_LABELS: ReadonlyMap<string, string> = new Map([
  ["user", "Users"],
  ["session", "Sessions"],
  ["favorite", "Favorites"],
  ["profile", "Profile"],
  ["food", "Food catalog"],
  ["restaurant", "Restaurants"],
  ["moderation", "Moderation"],
  ["support", "Support"],
  ["admin", "Administration"],
  ["role", "Roles and permissions"],
  ["audit", "Audit log"],
]);

interface DisplayText {
  readonly label: string;
  readonly description: string;
}

const DISPLAY_OVERRIDES: ReadonlyMap<string, DisplayText> = new Map([
  ["user:create", { label: "Create users", description: "Create new user accounts out of band." }],
  ["user:list", { label: "List users", description: "Browse and search the member directory." }],
  [
    "user:set-role",
    {
      label: "Legacy set-role",
      description: "Retired static-grant path; kept for vocabulary parity.",
    },
  ],
  [
    "user:ban",
    {
      label: "Ban and unban",
      description:
        "Suspend accounts or restore access; banning an owner additionally needs role:manage-protected and never removes the last active owner.",
    },
  ],
  ["user:delete", { label: "Delete users", description: "Permanently remove user accounts." }],
  [
    "user:set-password",
    {
      label: "Set password",
      description: "Reset another member's password without knowing the old one.",
    },
  ],
  [
    "user:set-email",
    { label: "Set email", description: "Change another member's sign-in email address." },
  ],
  ["user:get", { label: "View user detail", description: "Open one member's account record." }],
  ["user:update", { label: "Update users", description: "Edit member account fields." }],
  [
    "user:manage-roles",
    {
      label: "Manage memberships",
      description:
        "Assign or remove roles on members; every assignment additionally needs role:assign and only grants the caller already holds.",
    },
  ],
  ["session:list", { label: "List sessions", description: "Inspect active sessions." }],
  [
    "session:revoke",
    {
      label: "Revoke sessions",
      description:
        "End sessions; revoking a protected account's sessions additionally needs role:manage-protected.",
    },
  ],
  ["session:delete", { label: "Delete sessions", description: "Remove session records." }],
  [
    "session:revoke-own",
    { label: "Revoke own sessions", description: "Sign out the caller's own other devices." },
  ],
  [
    "session:revoke-any",
    {
      label: "Revoke any sessions",
      description:
        "End any member's sessions; protected accounts additionally need role:manage-protected.",
    },
  ],
  [
    "session:list-own",
    { label: "List own sessions", description: "See the caller's own active sessions." },
  ],
  [
    "session:list-any",
    { label: "List any sessions", description: "See any member's active sessions." },
  ],
  [
    "favorite:create",
    { label: "Save favorites", description: "Bookmark dishes to a personal collection." },
  ],
  ["favorite:read", { label: "Read favorites", description: "View personal favorite dishes." }],
  [
    "favorite:delete",
    { label: "Remove favorites", description: "Remove dishes from a personal collection." },
  ],
  ["profile:read", { label: "Read profile", description: "View the caller's own profile." }],
  ["profile:update", { label: "Update profile", description: "Edit the caller's own profile." }],
  ["food:read", { label: "Read dishes", description: "Browse published dish records." }],
  ["food:create", { label: "Create dishes", description: "Draft new dish records." }],
  ["food:update", { label: "Update dishes", description: "Edit dish metadata, names, and links." }],
  [
    "food:publish",
    {
      label: "Publish dishes",
      description:
        "Change dish status, including publishing immediately on create and status-only transitions.",
    },
  ],
  ["food:import", { label: "Import dishes", description: "Validate and apply bulk dish imports." }],
  [
    "restaurant:read",
    { label: "Read restaurants", description: "Browse verified restaurant places." },
  ],
  [
    "restaurant:submit",
    { label: "Submit restaurants", description: "Suggest new restaurant places for verification." },
  ],
  [
    "restaurant:verify",
    { label: "Verify restaurants", description: "Confirm submitted restaurant places." },
  ],
  [
    "moderation:read",
    { label: "Read review queue", description: "Open the moderation review queue." },
  ],
  ["moderation:resolve", { label: "Resolve reports", description: "Rule on moderation reports." }],
  [
    "support:read",
    { label: "Read support views", description: "Open limited account-support views." },
  ],
  ["support:manage", { label: "Manage support", description: "Run account-support operations." }],
  [
    "admin:access",
    {
      label: "Access administration",
      description: "Open administration surfaces; never authorizes a mutation by itself.",
    },
  ],
  [
    "role:create",
    {
      label: "Create roles",
      description: "Create custom roles; new roles start with zero grants.",
    },
  ],
  [
    "role:read",
    { label: "Read roles", description: "List roles, grants vocabulary, and member counts." },
  ],
  [
    "role:update",
    {
      label: "Update role metadata",
      description:
        "Edit slug, name, description, color, and position. Position orders display only and never confers permissions. Protected roles stay immutable.",
    },
  ],
  [
    "role:delete",
    {
      label: "Delete roles",
      description:
        "Delete custom roles. System roles can only be unassigned, and protected roles stay immutable.",
    },
  ],
  [
    "role:assign",
    {
      label: "Assign roles",
      description:
        "Grant or revoke role memberships; protected targets additionally need role:manage-protected.",
    },
  ],
  [
    "role:manage-permissions",
    {
      label: "Manage grants",
      description:
        "Replace a role's permission grants. Only permissions the caller holds may be granted, and protected roles stay immutable.",
    },
  ],
  [
    "role:manage-protected",
    {
      label: "Manage protected roles",
      description:
        "Touch the owner role: edit memberships, ban, or revoke sessions on protected accounts. Held by owners only; never delegatable by administrators.",
    },
  ],
  ["audit:read", { label: "Read audit log", description: "Inspect the security audit trail." }],
]);

const humanize = (action: string): string =>
  action
    .split("-")
    .map((part) => (part.length > 0 ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(" ");

const describeKey = (key: Permission): PermissionCatalogEntry => {
  const separator = key.indexOf(":");
  const group = separator === -1 ? key : key.slice(0, separator);
  const action = separator === -1 ? key : key.slice(separator + 1);
  const override = DISPLAY_OVERRIDES.get(key);

  return {
    key,
    group: GROUP_LABELS.get(group) ?? group,
    label: override?.label ?? humanize(action),
    description: override?.description ?? `Grant '${key}'.`,
  };
};

/**
 * Display catalog covering exactly the static vocabulary, in vocabulary
 * order. Route code groups entries by `group` for the permission fieldsets;
 * the key set itself is never extended here.
 */
export const permissionCatalog = (): ReadonlyArray<PermissionCatalogEntry> =>
  PERMISSION_KEYS.filter(isPermissionKey).map(describeKey);

/** Group headings in first-seen (vocabulary) order, for section rendering. */
export const permissionGroups = (): ReadonlyArray<{ group: string }> => {
  const seen = new Set<string>();
  const groups: Array<{ group: string }> = [];

  for (const entry of permissionCatalog()) {
    if (!seen.has(entry.group)) {
      seen.add(entry.group);
      groups.push({ group: entry.group });
    }
  }

  return groups;
};
