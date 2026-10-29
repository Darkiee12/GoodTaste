import { ShieldAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { AdminConfirmDialog } from "@/components/admin/ui";
import { messagesFor, type Locale } from "@/shared/i18n";

import type { MemberRow } from "./member-types";

export interface MemberAccountActionsProps {
  readonly banPending: boolean;
  readonly error: string | null;
  readonly isSelf: boolean;
  readonly lang: Locale;
  readonly member: MemberRow;
  readonly onRestore: () => void;
  readonly onSuspend: (reason: string) => void;
  readonly unbanPending: boolean;
}

/**
 * Drawer account section: suspend with an audit reason, restore when
 * suspended — never both. The reason is stored by the ban operation and
 * its audit record (the transport already accepts up to 500 characters);
 * an empty reason stays empty rather than inventing one. Self-actions call
 * out their impact in the confirm text.
 */
export function MemberAccountActions({
  banPending,
  error,
  isSelf,
  lang,
  member,
  onRestore,
  onSuspend,
  unbanPending,
}: MemberAccountActionsProps): ReactNode {
  const copy = messagesFor(lang);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selfWarning =
    lang === "vi"
      ? " Đây là tài khoản của chính bạn: tiếp tục sẽ đăng xuất bạn và thu hồi quyền truy cập của bạn."
      : " This is your own account: continuing will sign you out and revoke your access.";

  const trimmedReason = reason.trim();

  let reasonSuffix = "";

  if (trimmedReason !== "") {
    reasonSuffix = lang === "vi" ? ` Lý do: ${trimmedReason}` : ` Reason: ${trimmedReason}`;
  }

  const selfSuffix = isSelf ? selfWarning : "";
  const confirmDescription = `${copy.adminBanConfirm} ${member.email}${selfSuffix}${reasonSuffix}`;

  return (
    <section
      aria-labelledby={`${reasonId}-section`}
      className="mt-5 border-t border-border-soft pt-4"
    >
      <h3
        id={`${reasonId}-section`}
        className="flex items-center gap-1.5 text-sm font-bold text-ink"
      >
        <ShieldAlert aria-hidden="true" className="size-4 text-red-700" />
        {lang === "vi" ? "Tài khoản" : "Account"}
      </h3>

      {member.banned ? (
        <div className="mt-2">
          <p className="text-sm text-muted">
            {lang === "vi"
              ? "Tài khoản này đang bị tạm khóa và không thể truy cập."
              : "This account is suspended and cannot access the workspace."}
            {isSelf ? selfWarning : ""}
          </p>
          <button
            type="button"
            disabled={unbanPending}
            aria-busy={unbanPending}
            onClick={onRestore}
            className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-soft bg-white px-4 text-sm font-medium text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.authUnban}
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-muted">
            {lang === "vi"
              ? "Tạm khóa sẽ đăng xuất thành viên này và chặn truy cập cho đến khi được mở khóa. Hành động được ghi kiểm toán kèm lý do bên dưới."
              : "Suspending signs this member out and blocks access until restored. The action is audit-logged with the reason below."}
          </p>
          <label htmlFor={reasonId} className="mt-2 block text-sm font-medium text-ink">
            {lang === "vi"
              ? "Lý do tạm khóa (lưu vào kiểm toán)"
              : "Suspension reason (audit-logged)"}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            rows={2}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder={
              lang === "vi"
                ? "VD: vi phạm quy định cộng đồng…"
                : "E.g. community guideline violation…"
            }
            className="mt-1 min-h-11 w-full rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink focus:border-brand-blue"
          />
          <button
            type="button"
            disabled={banPending}
            aria-busy={banPending}
            onClick={() => {
              setConfirmOpen(true);
            }}
            className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-md border border-red-700 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.authBan}
          </button>
        </div>
      )}

      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}

      <AdminConfirmDialog
        open={confirmOpen && !member.banned}
        title={lang === "vi" ? "Tạm khóa thành viên này?" : "Suspend this member?"}
        description={confirmDescription}
        confirmLabel={copy.authBan}
        cancelLabel={copy.commonCancel}
        dangerous
        pending={banPending}
        onConfirm={() => {
          onSuspend(reason.trim());
          setConfirmOpen(false);
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
    </section>
  );
}
