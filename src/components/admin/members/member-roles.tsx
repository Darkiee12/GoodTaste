import { X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { AdminSelect } from "@/components/admin/select";
import { AdminConfirmDialog } from "@/components/admin/ui";
import { messagesFor, type Locale, type Messages } from "@/shared/i18n";

import {
  availableRoles,
  isPrivilegedRole,
  textOnRoleColor,
  type MemberRow,
  type RoleRow,
} from "./member-types";

export interface MemberRolesProps {
  readonly assignPending: boolean;
  readonly canManageProtected: boolean;
  readonly error: string | null;
  readonly lang: Locale;
  readonly member: MemberRow;
  readonly onAssign: (roleId: string) => void;
  readonly onRemove: (roleId: string) => void;
  readonly removePendingRoleId: string | null;
  readonly roles: ReadonlyArray<RoleRow>;
}

/** Suffix marking privileged grants in the add-role options. No nesting. */
const privilegedSuffix = (role: Pick<RoleRow, "isProtected" | "slug">, lang: Locale): string => {
  if (!isPrivilegedRole(role)) {
    return "";
  }

  if (lang === "vi") {
    return " (cần xác nhận)";
  }

  return " (confirmation required)";
};

/** Confirm title for a privileged grant. No nesting. */
const privilegedTitle = (roleName: string | null, lang: Locale, copy: Messages): string => {
  if (roleName === null) {
    return copy.authAssignRole;
  }

  if (lang === "vi") {
    return `Gán vai trò ${roleName}?`;
  }

  return `Assign the ${roleName} role?`;
};

/** Confirm description for a privileged grant. No nesting. */
const privilegedDescription = (roleName: string | null, email: string, lang: Locale): string => {
  if (roleName === null) {
    return "";
  }

  if (lang === "vi") {
    return `Đây là vai trò đặc quyền cho ${email}. Quyền này mở rộng phạm vi truy cập đáng kể và được ghi kiểm toán. Chỉ tiếp tục khi bạn chắc chắn.`;
  }

  return `This is a privileged grant for ${email}. It materially widens access and is audit-logged. Continue only if you intend exactly this grant.`;
};

/**
 * Drawer roles section: wrapping chips with keyboard-accessible remove
 * buttons plus a compact add control. Assigned roles never appear as
 * options; protected roles the caller cannot manage are excluded (server
 * denials still surface as errors — client filtering is hint-only).
 * Privileged grants require an explicit impact confirmation and are never
 * applied optimistically.
 */
export function MemberRoles({
  assignPending,
  canManageProtected,
  error,
  lang,
  member,
  onAssign,
  onRemove,
  removePendingRoleId,
  roles,
}: MemberRolesProps): ReactNode {
  const copy = messagesFor(lang);
  const selectId = useId();
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [confirmRoleId, setConfirmRoleId] = useState<string | null>(null);

  const roleById = (roleId: string): RoleRow | null =>
    roles.find((role) => role.id === roleId) ?? null;

  const options = availableRoles(roles, member.roles, canManageProtected);
  const confirmRole = confirmRoleId === null ? null : roleById(confirmRoleId);
  const confirmRoleName = confirmRole === null ? null : confirmRole.name;

  const requestAssign = (roleId: string): void => {
    const role = roleById(roleId);

    if (role === null) {
      return;
    }

    if (isPrivilegedRole(role)) {
      setConfirmRoleId(roleId);

      return;
    }

    onAssign(roleId);
    setSelectedRoleId("");
  };

  return (
    <section aria-labelledby={`${selectId}-section`} className="mt-5">
      <h3 id={`${selectId}-section`} className="text-sm font-bold text-ink">
        {copy.authRoles}
      </h3>
      {member.roles.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {member.roles.map((roleId) => {
            const role = roleById(roleId);
            const name = role?.name ?? roleId;
            const color = role?.color ?? "#f0e2cf";
            const removeLabel = `Remove ${name} from ${member.email}`;
            const removing = removePendingRoleId === roleId;

            return (
              <li
                key={roleId}
                className="inline-flex max-w-full items-center gap-1 rounded-full border py-1 pr-1 pl-2.5 text-xs font-semibold"
                style={{ borderColor: color, backgroundColor: "#ffffff" }}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="max-w-40 truncate" style={{ color: textOnRoleColor("#ffffff") }}>
                  {name}
                </span>
                <button
                  type="button"
                  aria-label={removeLabel}
                  title={removeLabel}
                  disabled={removing || assignPending}
                  aria-busy={removing}
                  onClick={() => {
                    onRemove(roleId);
                  }}
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition hover:bg-cream hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {lang === "vi" ? "Chưa có vai trò nào." : "No roles assigned yet."}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor={selectId} className="block text-sm font-medium text-ink">
          {copy.authAssignRole}
        </label>
        {options.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted">
            {lang === "vi" ? "Không còn vai trò nào để gán." : "No additional roles available."}
          </p>
        ) : (
          <div className="mt-1.5 flex min-w-0 gap-2">
            <AdminSelect
              id={selectId}
              value={selectedRoleId === "" ? undefined : selectedRoleId}
              onValueChange={setSelectedRoleId}
              options={options.map((role) => ({
                label: `${role.name}${privilegedSuffix(role, lang)}`,
                value: role.id,
              }))}
              placeholder={copy.authAssignRole}
              disabled={assignPending}
              triggerClassName="min-w-0 flex-1"
            />
            <button
              type="button"
              disabled={assignPending || selectedRoleId === ""}
              aria-busy={assignPending}
              onClick={() => {
                if (selectedRoleId !== "") {
                  requestAssign(selectedRoleId);
                }
              }}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copy.authAssign}
            </button>
          </div>
        )}
      </div>

      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}

      <AdminConfirmDialog
        open={confirmRole !== null}
        title={privilegedTitle(confirmRoleName, lang, copy)}
        description={privilegedDescription(confirmRoleName, member.email, lang)}
        confirmLabel={copy.authAssign}
        cancelLabel={copy.commonCancel}
        dangerous
        pending={assignPending}
        onConfirm={() => {
          if (confirmRoleId !== null) {
            onAssign(confirmRoleId);
            setConfirmRoleId(null);
            setSelectedRoleId("");
          }
        }}
        onCancel={() => {
          setConfirmRoleId(null);
        }}
      />
    </section>
  );
}
