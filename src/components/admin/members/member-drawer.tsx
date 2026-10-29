import { Check, Copy, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";

import { formatAdminDate } from "@/shared/format";
import type { Locale, Messages } from "@/shared/i18n";

import { MemberAccountActions } from "./member-account-actions";
import { MemberRoles } from "./member-roles";
import { displayNameOf, initialOf, type MemberRow, type RoleRow } from "./member-types";

export interface MemberDrawerProps {
  readonly accountError: string | null;
  readonly announcement: string | null;
  readonly assignPending: boolean;
  readonly banPending: boolean;
  readonly canManageProtected: boolean;
  readonly copy: Messages;
  readonly currentUserId: string | null;
  readonly lang: Locale;
  readonly member: MemberRow | null;
  readonly modalPending: boolean;
  readonly onAssign: (input: { readonly roleId: string; readonly userId: string }) => void;
  readonly onClose: () => void;
  readonly onRemove: (input: { readonly roleId: string; readonly userId: string }) => void;
  readonly onRestore: (userId: string) => void;
  readonly onSuspend: (input: { readonly reason: string; readonly userId: string }) => void;
  readonly removePendingRoleId: string | null;
  readonly roles: ReadonlyArray<RoleRow>;
  readonly rolesError: string | null;
  readonly unbanPending: boolean;
}

/**
 * Right-side member drawer. Fixed overlay positioning means the table never
 * shifts; Radix Dialog (modal) supplies the focus trap, Escape handling, and
 * background scroll lock. Backdrop dismissal is suppressed while a mutation
 * for the open member is pending — the close button and Escape still work.
 */
export function MemberDrawer({
  accountError,
  announcement,
  assignPending,
  banPending,
  canManageProtected,
  copy,
  currentUserId,
  lang,
  member,
  modalPending,
  onAssign,
  onClose,
  onRemove,
  onRestore,
  onSuspend,
  removePendingRoleId,
  roles,
  rolesError,
  unbanPending,
}: MemberDrawerProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const copyEmail = async (email: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog.Root
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          onInteractOutside={(event) => {
            if (modalPending) {
              event.preventDefault();
            }
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-xl focus:outline-none sm:w-[440px] sm:max-w-[min(480px,100vw)] sm:border-l sm:border-border-soft"
        >
          {member === null ? null : (
            <>
              <div className="sticky top-0 flex items-start justify-between gap-2 border-b border-border-soft bg-white px-5 py-4">
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-lg font-bold text-ink">
                    {displayNameOf(member)}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    {`Manage roles and account for ${member.email}`}
                  </Dialog.Description>
                  <p className="mt-0.5 text-xs text-muted">
                    {lang === "vi" ? "Thành viên Feast Lab" : "Feast Lab member"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={copy.adminUserCloseDetails}
                  title={copy.adminUserCloseDetails}
                  onClick={onClose}
                  className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-white text-ink hover:bg-cream focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>

              <div key={member.id} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-blue/10 text-lg font-bold text-brand-blue"
                  >
                    {initialOf(displayNameOf(member))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{member.email}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      {member.banned ? (
                        <span className="inline-block rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                          {copy.authSuspended}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full border border-border-soft bg-cream px-2 py-0.5 text-xs font-medium text-muted">
                          {copy.authActive}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {copy.adminJoined} {formatAdminDate(member.createdAt, lang)}
                      </span>
                      <button
                        type="button"
                        aria-label={lang === "vi" ? "Sao chép email" : "Copy email"}
                        title={lang === "vi" ? "Sao chép email" : "Copy email"}
                        onClick={() => {
                          void copyEmail(member.email);
                        }}
                        className="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-white text-muted hover:bg-cream hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none"
                      >
                        {copied ? (
                          <Check aria-hidden="true" className="size-3.5" />
                        ) : (
                          <Copy aria-hidden="true" className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <details className="mt-3 rounded-md border border-border-soft bg-cream/50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">
                    {lang === "vi" ? "Chi tiết tài khoản" : "Account details"}
                  </summary>
                  <p className="mt-1 text-xs break-all text-muted">
                    <span className="font-semibold">ID:</span> {member.id}
                  </p>
                </details>

                <MemberRoles
                  assignPending={assignPending}
                  canManageProtected={canManageProtected}
                  error={rolesError}
                  lang={lang}
                  member={member}
                  onAssign={(roleId) => {
                    onAssign({ roleId, userId: member.id });
                  }}
                  onRemove={(roleId) => {
                    onRemove({ roleId, userId: member.id });
                  }}
                  removePendingRoleId={removePendingRoleId}
                  roles={roles}
                />

                <MemberAccountActions
                  banPending={banPending}
                  error={accountError}
                  isSelf={currentUserId !== null && currentUserId === member.id}
                  lang={lang}
                  member={member}
                  onRestore={() => {
                    onRestore(member.id);
                  }}
                  onSuspend={(reason) => {
                    onSuspend({ reason, userId: member.id });
                  }}
                  unbanPending={unbanPending}
                />

                <output aria-live="polite" className="sr-only">
                  {announcement ?? ""}
                </output>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
