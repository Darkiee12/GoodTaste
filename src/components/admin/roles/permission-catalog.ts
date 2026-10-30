/**
 * Human-readable permission catalog for the Roles editor.
 *
 * The server vocabulary is a flat list of stable `resource:action` keys.
 * The editor displays a localized display name + description + group and
 * keeps the raw key only as the stable identity (selection state, server
 * payloads). Never render the raw key as a visible label.
 */

export interface PermissionEntry {
  readonly key: string;
  readonly group: string;
  readonly displayName: string;
  readonly description: string;
  readonly dangerous: boolean;
}

const GROUP_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map([
  ["admin", { en: "Administration", vi: "Quản trị" }],
  ["audit", { en: "Audit log", vi: "Nhật ký kiểm tra" }],
  ["favorite", { en: "Saved dishes", vi: "Món đã lưu" }],
  ["food", { en: "Dishes", vi: "Món ăn" }],
  ["moderation", { en: "Moderation", vi: "Kiểm duyệt" }],
  ["profile", { en: "Profiles", vi: "Hồ sơ" }],
  ["restaurant", { en: "Restaurants", vi: "Quán ăn" }],
  ["role", { en: "Roles", vi: "Vai trò" }],
  ["session", { en: "Sessions", vi: "Phiên đăng nhập" }],
  ["support", { en: "Support", vi: "Hỗ trợ" }],
  ["user", { en: "Members", vi: "Thành viên" }],
]);

const ACTION_LABELS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map([
  ["access", { en: "Access", vi: "Truy cập" }],
  ["assign", { en: "Assign", vi: "Gán" }],
  ["ban", { en: "Suspend members", vi: "Tạm khóa thành viên" }],
  ["create", { en: "Create", vi: "Tạo" }],
  ["delete", { en: "Delete", vi: "Xóa" }],
  ["get", { en: "View details", vi: "Xem chi tiết" }],
  ["import", { en: "Import", vi: "Nhập liệu" }],
  ["list", { en: "List", vi: "Xem danh sách" }],
  ["list-any", { en: "List all sessions", vi: "Xem mọi phiên" }],
  ["list-own", { en: "List own sessions", vi: "Xem phiên của mình" }],
  ["manage", { en: "Manage", vi: "Quản lý" }],
  ["manage-permissions", { en: "Manage grants", vi: "Quản lý quyền" }],
  ["manage-protected", { en: "Manage protected roles", vi: "Quản lý vai trò bảo vệ" }],
  ["manage-roles", { en: "Manage member roles", vi: "Quản lý vai trò thành viên" }],
  ["publish", { en: "Publish", vi: "Xuất bản" }],
  ["read", { en: "View", vi: "Xem" }],
  ["resolve", { en: "Resolve reports", vi: "Xử lý báo cáo" }],
  ["revoke", { en: "Revoke", vi: "Thu hồi" }],
  ["revoke-any", { en: "Revoke any session", vi: "Thu hồi mọi phiên" }],
  ["revoke-own", { en: "Revoke own sessions", vi: "Thu hồi phiên của mình" }],
  ["set-email", { en: "Change email", vi: "Đổi email" }],
  ["set-password", { en: "Change password", vi: "Đổi mật khẩu" }],
  ["set-role", { en: "Change role", vi: "Đổi vai trò" }],
  ["submit", { en: "Submit", vi: "Đề xuất" }],
  ["update", { en: "Edit", vi: "Sửa" }],
  ["verify", { en: "Verify", vi: "Xác minh" }],
]);

const RESOURCE_NOUNS: ReadonlyMap<string, { readonly en: string; readonly vi: string }> = new Map([
  ["admin", { en: "Feast Lab", vi: "Feast Lab" }],
  ["audit", { en: "audit events", vi: "sự kiện kiểm tra" }],
  ["favorite", { en: "saved dishes", vi: "món đã lưu" }],
  ["food", { en: "dishes", vi: "món ăn" }],
  ["moderation", { en: "moderation queue", vi: "hàng chờ kiểm duyệt" }],
  ["profile", { en: "profiles", vi: "hồ sơ" }],
  ["restaurant", { en: "restaurants", vi: "quán ăn" }],
  ["role", { en: "roles", vi: "vai trò" }],
  ["session", { en: "sessions", vi: "phiên đăng nhập" }],
  ["support", { en: "support inbox", vi: "hộp thư hỗ trợ" }],
  ["user", { en: "members", vi: "thành viên" }],
]);

const humanize = (value: string): string =>
  value
    .split("-")
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

/**
 * Grants whose misuse silently escalates privilege or destroys data.
 * Rendered with a distinct "sensitive" marker — never more decoration.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  "food:publish",
  "moderation:resolve",
  "role:assign",
  "role:create",
  "role:delete",
  "role:manage-permissions",
  "role:manage-protected",
  "role:update",
  "session:revoke-any",
  "support:manage",
  "user:ban",
  "user:delete",
  "user:manage-roles",
  "user:set-email",
  "user:set-password",
]);

export type RolesLocale = "en" | "vi";

export const buildPermissionCatalog = (
  vocabulary: ReadonlyArray<string>,
  locale: RolesLocale,
): ReadonlyMap<string, ReadonlyArray<PermissionEntry>> => {
  const groups = new Map<string, Array<PermissionEntry>>();

  for (const key of vocabulary) {
    const separator = key.indexOf(":");

    if (separator < 0) {
      continue;
    }

    const resource = key.slice(0, separator);
    const action = key.slice(separator + 1);
    const group = GROUP_LABELS.get(resource) ?? null;
    const actionLabel = ACTION_LABELS.get(action) ?? null;
    const noun = RESOURCE_NOUNS.get(resource) ?? null;
    const lang: "en" | "vi" = locale === "vi" ? "vi" : "en";
    const nounLabel = noun?.[lang] ?? humanize(resource);

    const displayName =
      actionLabel === null
        ? `${humanize(action)} ${nounLabel}`.trim()
        : `${actionLabel[lang]} ${nounLabel}`.trim();

    const groupLabel = group?.[lang] ?? humanize(resource);

    const description =
      lang === "vi"
        ? `Có thể ${displayName.toLowerCase()} trong nhóm ${groupLabel}.`
        : `Can ${displayName.toLowerCase()} in ${groupLabel}.`;

    const entry: PermissionEntry = {
      key,
      group: groupLabel,
      displayName,
      description,
      dangerous: DANGEROUS_KEYS.has(key),
    };

    const list = groups.get(entry.group);

    if (list === undefined) {
      groups.set(entry.group, [entry]);
    } else {
      list.push(entry);
    }
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  return groups;
};
