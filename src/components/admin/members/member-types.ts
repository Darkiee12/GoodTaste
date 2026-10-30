import { z } from "zod";

import type {
  adminFindUserByEmailFn,
  adminListRolesFn,
  adminListUsersFn,
} from "@/modules/user/admin.functions";

/**
 * Feast Lab members drawer shared types and pure helpers.
 *
 * Transport shapes are inferred from the admin server functions (Reylo
 * rows behind them), never hand-copied: the table and drawer render exactly
 * what the server returned. All member selection flows through
 * `selectMember` keyed by the selected member id so a stale read for a
 * previously selected member can never overwrite the current drawer.
 */

export type MemberRow = Awaited<ReturnType<typeof adminListUsersFn>>[number];

export type RoleRow = Awaited<ReturnType<typeof adminListRolesFn>>["roles"][number];

export type SearchedMember = Awaited<ReturnType<typeof adminFindUserByEmailFn>>;

/** Compact inline role count for the table surface. */
export const MAX_INLINE_ROLES = 2;

/** Slugs that always require an explicit impact confirmation when granted. */
const PRIVILEGED_SLUGS: ReadonlySet<string> = new Set(["admin", "owner"]);

/** Display name with email-prefix fallback. Never renders a bare email heading. */
export const displayNameOf = (member: Pick<MemberRow, "email" | "name">): string => {
  const trimmed = member.name.trim();

  if (trimmed !== "") {
    return trimmed;
  }

  const prefix = member.email.split("@")[0] ?? "";

  return prefix === "" ? member.email : prefix;
};

/** Initial for the drawer avatar placeholder. */
export const initialOf = (displayName: string): string => {
  const first = displayName.trim().charAt(0);

  return first === "" ? "?" : first.toUpperCase();
};

/** Compact table summary: "Owner · Curator · +3". */
export const compactRoleSummary = (
  names: ReadonlyArray<string>,
  max: number = MAX_INLINE_ROLES,
): string => {
  if (names.length === 0) {
    return "—";
  }

  const shown = names.slice(0, max);
  const remainder = names.length - shown.length;

  return remainder > 0 ? `${shown.join(" · ")} · +${remainder}` : shown.join(" · ");
};

/**
 * Principal-state member derivation. The selected id is the only state;
 * list rows and the email-search result are read-only inputs. A result that
 * does not match the selected id (for example a search that resolved after
 * the operator moved on) never leaks into another member's drawer.
 */
export const selectMember = (
  members: ReadonlyArray<MemberRow>,
  searched: MemberRow | SearchedMember | null,
  selectedId: string | null,
): MemberRow | null => {
  if (selectedId === null) {
    return null;
  }

  const listed = members.find((entry) => entry.id === selectedId);

  if (listed !== undefined) {
    return listed;
  }

  if (searched !== null && searched.id === selectedId) {
    return searched;
  }

  return null;
};

/** Roles still grantable: assigned ones are filtered out unconditionally. */
export const availableRoles = (
  roles: ReadonlyArray<RoleRow>,
  assigned: ReadonlyArray<string>,
  canManageProtected: boolean,
): ReadonlyArray<RoleRow> => {
  const held = new Set(assigned);

  return roles.filter((role) => {
    if (held.has(role.id)) {
      return false;
    }

    if (role.isProtected && !canManageProtected) {
      return false;
    }

    return true;
  });
};

/** Privileged grants need an explicit impact confirmation, never a silent assign. */
export const isPrivilegedRole = (role: Pick<RoleRow, "isProtected" | "slug">): boolean =>
  role.isProtected || PRIVILEGED_SLUGS.has(role.slug);

/** Contrasting label color (navy or white) for a role-color chip. */
export const textOnRoleColor = (hex: string): "#172033" | "#ffffff" => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());

  if (match?.[1] === undefined) {
    return "#172033";
  }

  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
    return "#172033";
  }

  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.6 ? "#172033" : "#ffffff";
};

export type FailureKind = "generic" | "last-owner" | "permissions" | "protected" | "recent-auth";

/** Server-function rejections arrive as Error instances or tagged failures. */
export type FailureCandidate = Error | { readonly _tag?: string | undefined } | null | undefined;

const failureTagSchema = z.object({ _tag: z.string() });

/**
 * Maps a server-function rejection to a drawer-safe failure kind. Backend
 * checks stay authoritative; this only chooses which safe message to show.
 * Client-side disabling is ever a hint — denials always surface here.
 */
export const failureKindOf = (error: FailureCandidate): FailureKind => {
  const parsed = failureTagSchema.safeParse(error);
  const tag = parsed.success ? parsed.data._tag : "";

  const message = error instanceof Error ? error.message : tag;
  const haystack = `${tag} ${message}`;

  if (haystack.includes("LastOwnerRemovalDenied")) {
    return "last-owner";
  }

  if (haystack.includes("RecentAuthenticationRequired")) {
    return "recent-auth";
  }

  if (
    haystack.includes("ProtectedRole") ||
    haystack.includes("RoleNotManageable") ||
    haystack.includes("RoleNotFound")
  ) {
    return "protected";
  }

  if (
    haystack.includes("InsufficientPermissions") ||
    haystack.includes("OwnershipDenied") ||
    haystack.includes("Forbidden")
  ) {
    return "permissions";
  }

  return "generic";
};
