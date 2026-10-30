import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { formatAdminDate } from "@/shared/format";
import { messagesFor, type Locale } from "@/shared/i18n";

import { compactRoleSummary, displayNameOf, type MemberRow } from "./member-types";

export interface MemberTableProps {
  readonly lang: Locale;
  readonly members: ReadonlyArray<MemberRow>;
  readonly onManage: (memberId: string, trigger: HTMLButtonElement) => void;
  readonly roleNameOf: (roleId: string) => string;
}

/**
 * Primary members surface: display name first (email-prefix fallback),
 * email secondary, compact role summary. The per-row action is a single
 * icon button that opens the drawer — the table itself never shifts.
 */
export function MemberTable({ lang, members, onManage, roleNameOf }: MemberTableProps): ReactNode {
  const copy = messagesFor(lang);

  if (members.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-border-soft bg-white p-6 text-sm text-muted shadow-sm">
        {copy.adminNoResults}
      </p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border-soft bg-white shadow-sm">
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <caption className="sr-only">{copy.adminMembers}</caption>
        <thead>
          <tr className="border-b border-border-soft bg-cream/60">
            <th scope="col" className="px-4 py-3 font-semibold">
              {copy.adminMembers}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {copy.adminStatus}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {copy.authRoles}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {copy.adminJoined}
            </th>
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">{copy.adminActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((entry) => {
            const displayName = displayNameOf(entry);
            const manageLabel = `Manage roles and account for ${entry.email}`;
            const roleNames = entry.roles.map((roleId) => roleNameOf(roleId));

            return (
              <tr key={entry.id} className="border-b border-border-soft last:border-0">
                <td className="max-w-56 px-4 py-3">
                  <div className="truncate font-medium text-ink">{displayName}</div>
                  <div className="max-w-56 truncate text-xs text-muted">{entry.email}</div>
                </td>
                <td className="px-4 py-3">
                  {entry.banned ? (
                    <span className="inline-block rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                      {copy.authSuspended}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-border-soft bg-cream px-2 py-0.5 text-xs font-medium text-muted">
                      {copy.authActive}
                    </span>
                  )}
                </td>
                <td className="max-w-64 truncate px-4 py-3 text-muted" title={roleNames.join(", ")}>
                  {compactRoleSummary(roleNames)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {formatAdminDate(entry.createdAt, lang)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    aria-label={manageLabel}
                    title={manageLabel}
                    onClick={(event) => {
                      onManage(entry.id, event.currentTarget);
                    }}
                    className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink transition hover:bg-cream focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none"
                  >
                    <Settings2 aria-hidden="true" className="size-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
