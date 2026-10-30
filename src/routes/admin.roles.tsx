import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  buildPermissionCatalog,
  CreateRoleDialog,
  draftOf,
  draftsEqual,
  RoleEditor,
  RoleNavigator,
  validateDraft,
  type CreateRoleDialogStrings,
  type DraftFieldErrors,
  type RoleDraft,
  type RoleEditorStrings,
  type RoleEntry,
  type RoleNavigatorStrings,
  type RolesCapabilities,
} from "@/components/admin/roles";
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminEmptyState,
  AdminGhostButton,
  AdminSecondaryButton,
} from "@/components/admin/ui";
import {
  GlobalNotification,
  type GlobalNotificationVariant,
} from "@/components/ui/global-notification";
import {
  adminCreateRoleFn,
  adminDeleteRoleFn,
  adminListRolesFn,
  adminRoleMemberCountsFn,
  adminSetRoleGrantsFn,
  adminUpdateRoleFn,
  authorizeFn,
} from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { messagesFor, type Locale } from "@/shared/i18n";

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
      data: { checks: [{ resource: "role", actions: ["read"] }] },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async () => {
    const [catalog, counts] = await Promise.all([adminListRolesFn(), adminRoleMemberCountsFn()]);

    return { roles: catalog.roles, vocabulary: catalog.vocabulary, counts };
  },
  component: AdminRoles,
});

interface Notice {
  readonly variant: GlobalNotificationVariant;
  readonly title: string;
  readonly description: string;
}

const firstOrdered = (roles: ReadonlyArray<RoleEntry>): RoleEntry | null => {
  let first: RoleEntry | null = null;

  for (const role of roles) {
    if (first === null || role.position < first.position) {
      first = role;
    }
  }

  return first;
};

const capabilityQuery = (action: string) => ({
  queryKey: ["admin", "capabilities", "roles", action] as const,
  queryFn: () =>
    authorizeFn({ data: { checks: [{ resource: "role", actions: [action] }] } }).then(
      (result) => result.allowed,
    ),
  initialData: false,
  staleTime: 60_000,
  retry: 1,
});

function AdminRoles() {
  const initial = Route.useLoaderData();
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const locale: "en" | "vi" = lang === "vi" ? "vi" : "en";

  const [roles, setRoles] = useState<ReadonlyArray<RoleEntry>>(initial.roles);
  const [counts, setCounts] = useState(initial.counts);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, RoleDraft>>(new Map());

  const [activeRoleId, setActiveRoleId] = useState<string | null>(
    () => firstOrdered(initial.roles)?.id ?? null,
  );

  const [mobileEditing, setMobileEditing] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleEntry | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState<ReadonlySet<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<DraftFieldErrors | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const canCreateQuery = useQuery(capabilityQuery("create"));
  const canUpdateQuery = useQuery(capabilityQuery("update"));
  const canGrantsQuery = useQuery(capabilityQuery("manage-permissions"));
  const canDeleteQuery = useQuery(capabilityQuery("delete"));

  const capabilities: RolesCapabilities = useMemo(
    () => ({
      canCreate: canCreateQuery.data,
      canUpdate: canUpdateQuery.data,
      canManagePermissions: canGrantsQuery.data,
      canDelete: canDeleteQuery.data,
    }),
    [canCreateQuery.data, canUpdateQuery.data, canGrantsQuery.data, canDeleteQuery.data],
  );

  const catalog = useMemo(
    () => buildPermissionCatalog(initial.vocabulary, locale),
    [initial.vocabulary, locale],
  );

  const totalPermissions = initial.vocabulary.length;

  const countMap = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of counts) {
      map.set(entry.roleId, entry.memberCount);
    }

    return map;
  }, [counts]);

  const activeRole = roles.find((role) => role.id === activeRoleId) ?? null;

  const activeDraft =
    activeRole === null ? null : (drafts.get(activeRole.id) ?? draftOf(activeRole));

  const activeDirty =
    activeRole !== null && activeDraft !== null && !draftsEqual(activeDraft, draftOf(activeRole));

  const dirtyRoleIds = useMemo(() => {
    const dirty = new Set<string>();

    for (const role of roles) {
      const draft = drafts.get(role.id);

      if (draft !== undefined && !draftsEqual(draft, draftOf(role))) {
        dirty.add(role.id);
      }
    }

    return dirty;
  }, [roles, drafts]);

  useEffect(() => {
    if (dirtyRoleIds.size === 0) {
      return () => undefined;
    }

    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", guard);

    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirtyRoleIds.size]);

  const strings = useMemo(() => stringsFor(lang, copy), [lang, copy]);

  const setDraftPatch = (roleId: string, patch: Partial<RoleDraft>): void => {
    const role = roles.find((entry) => entry.id === roleId);

    if (role === undefined) {
      return;
    }

    setDrafts((prev) => {
      const base = prev.get(roleId) ?? draftOf(role);
      const next = { ...base, ...patch };

      if (draftsEqual(next, draftOf(role))) {
        if (!prev.has(roleId)) {
          return prev;
        }

        const cleaned = new Map(prev);
        cleaned.delete(roleId);

        return cleaned;
      }

      return new Map(prev).set(roleId, next);
    });
    setSaveErrors(null);
  };

  const toggleGrant = (roleId: string, key: string): void => {
    const role = roles.find((entry) => entry.id === roleId);
    const draft = drafts.get(roleId) ?? (role === undefined ? null : draftOf(role));

    if (role === undefined || draft === null) {
      return;
    }

    const next = draft.permissions.includes(key)
      ? draft.permissions.filter((entry) => entry !== key)
      : [...draft.permissions, key];

    setDraftPatch(roleId, { permissions: next });
  };

  const saveRole = async (roleId: string): Promise<boolean> => {
    const role = roles.find((entry) => entry.id === roleId);
    const draft = drafts.get(roleId);

    if (role === undefined || draft === undefined) {
      return true;
    }

    if (draftsEqual(draft, draftOf(role))) {
      return true;
    }

    const errors = validateDraft(draft, strings.editor);

    if (errors.name !== undefined || errors.color !== undefined) {
      setSaveErrors(errors);
      setNotice({ variant: "error", ...strings.notices.validation });

      return false;
    }

    const original = draftOf(role);

    const metaDirty =
      draft.name !== original.name ||
      draft.description !== original.description ||
      draft.color.toLowerCase() !== original.color.toLowerCase() ||
      draft.position !== original.position;

    const grantsDirty =
      draft.permissions.length !== original.permissions.length ||
      draft.permissions.some((permission) => !original.permissions.includes(permission));

    setSavingId(roleId);

    try {
      if (metaDirty) {
        const updated = await adminUpdateRoleFn({
          data: {
            role_id: roleId,
            slug: role.slug,
            name: draft.name.trim(),
            description: draft.description,
            color: draft.color.trim(),
            position: Number.parseInt(draft.position, 10) || 0,
          },
        });

        setRoles((prev) =>
          prev.map((entry) => (entry.id === roleId ? { ...entry, ...updated } : entry)),
        );
      }

      if (grantsDirty) {
        try {
          await adminSetRoleGrantsFn({
            data: { role_id: roleId, permissions: [...draft.permissions] },
          });
        } catch {
          setPartialFailures((prev) => new Set(prev).add(roleId));
          setNotice({ variant: "warning", ...strings.notices.partial });

          return false;
        }
      }

      setRoles((prev) =>
        prev.map((entry) =>
          entry.id === roleId
            ? {
                ...entry,
                name: draft.name.trim(),
                description: draft.description,
                color: draft.color.trim(),
                position: Number.parseInt(draft.position, 10) || 0,
                permissions: [...draft.permissions],
              }
            : entry,
        ),
      );
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(roleId);

        return next;
      });
      setPartialFailures((prev) => {
        if (!prev.has(roleId)) {
          return prev;
        }

        const next = new Set(prev);
        next.delete(roleId);

        return next;
      });
      setSaveErrors(null);
      setNotice({ variant: "success", ...strings.notices.saved(draft.name.trim()) });

      return true;
    } catch {
      setNotice({ variant: "error", ...strings.notices.saveFailed });

      return false;
    } finally {
      setSavingId(null);
    }
  };

  const selectRole = (roleId: string): void => {
    if (savingId !== null || roleId === activeRoleId) {
      if (roleId === activeRoleId) {
        setMobileEditing(true);
      }

      return;
    }

    if (activeDirty) {
      setPendingSwitch(roleId);

      return;
    }

    setSaveErrors(null);
    setActiveRoleId(roleId);
    setMobileEditing(true);
  };

  const resolveSwitch = (target: string | null): void => {
    setPendingSwitch(null);

    if (target === null) {
      return;
    }

    setSaveErrors(null);

    if (target === "back") {
      setMobileEditing(false);

      return;
    }

    setActiveRoleId(target);
    setMobileEditing(true);
  };

  const saveAndSwitch = (): void => {
    if (activeRoleId === null) {
      resolveSwitch(pendingSwitch);

      return;
    }

    const target = pendingSwitch;

    void saveRole(activeRoleId).then((saved) => {
      if (saved) {
        resolveSwitch(target);
      } else {
        setPendingSwitch(null);
      }
    });
  };

  const discardAndSwitch = (): void => {
    setSaveErrors(null);

    if (activeRoleId !== null) {
      setDrafts((prev) => {
        if (!prev.has(activeRoleId)) {
          return prev;
        }

        const next = new Map(prev);
        next.delete(activeRoleId);

        return next;
      });
      setPartialFailures((prev) => {
        if (!prev.has(activeRoleId)) {
          return prev;
        }

        const next = new Set(prev);
        next.delete(activeRoleId);

        return next;
      });
    }

    resolveSwitch(pendingSwitch);
  };

  const createRole = async (input: {
    readonly slug: string;
    readonly name: string;
  }): Promise<void> => {
    setCreating(true);
    setCreateFailed(false);

    try {
      const created = await adminCreateRoleFn({
        data: {
          slug: input.slug,
          name: input.name,
          description: "",
          color: "#6b7280",
          position: 0,
        },
      });

      // Reload the catalog but keep every unrelated draft intact: only the
      // role list and member counts are replaced.
      const [catalogResult, list] = await Promise.all([
        adminListRolesFn(),
        adminRoleMemberCountsFn(),
      ]);

      setRoles(catalogResult.roles);
      setCounts(list);
      setActiveRoleId(created.id);
      setMobileEditing(true);
      setCreateOpen(false);
      setNotice({ variant: "success", ...strings.notices.created(input.name) });
    } catch {
      setCreateFailed(true);
      setNotice({ variant: "error", ...strings.notices.createFailed });
    } finally {
      setCreating(false);
    }
  };

  // Delete runs through TanStack Query so the failure is a value
  // (mutation error state), never a thrown rejection: no try/catch needed.
  const deleteMutation = useMutation({
    mutationFn: (target: { readonly id: string; readonly name: string }) =>
      adminDeleteRoleFn({ data: { role_id: target.id } }),
    onSuccess: (_, target) => {
      const remaining = roles.filter((entry) => entry.id !== target.id);

      if (activeRoleId === target.id) {
        setActiveRoleId(firstOrdered(remaining)?.id ?? null);
        setMobileEditing(false);
      }

      setRoles(remaining);
      setDrafts((prev) => {
        if (!prev.has(target.id)) {
          return prev;
        }

        const next = new Map(prev);
        next.delete(target.id);

        return next;
      });
      setDeleteTarget(null);
      setNotice({ variant: "success", ...strings.notices.deleted(target.name) });
    },
    onError: () => {
      setNotice({ variant: "error", ...strings.notices.deleteFailed });
    },
  });

  const deleteRole = (target: RoleEntry): void => {
    deleteMutation.mutate({ id: target.id, name: target.name });
  };

  const pendingRole = pendingSwitch === null || pendingSwitch === "back" ? null : pendingSwitch;

  return (
    <div className="min-w-0">
      {notice === null ? null : (
        <GlobalNotification
          variant={notice.variant}
          title={notice.title}
          description={notice.description}
          closeLabel={copy.adminNotificationDismiss}
          autoDismissMs={notice.variant === "error" ? undefined : 6000}
          onClose={() => {
            setNotice(null);
          }}
        />
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-4xl tracking-wide">{copy.authRoles}</h1>
        {dirtyRoleIds.size > 0 ? (
          <output className="text-sm font-semibold text-food-orange-dark">
            {strings.unsavedBadge(dirtyRoleIds.size)}
          </output>
        ) : null}
      </div>
      {roles.length === 0 ? (
        <div className="mt-4">
          <AdminEmptyState
            message={copy.adminNoResults}
            action={
              capabilities.canCreate === true ? (
                <AdminSecondaryButton
                  type="button"
                  onClick={() => {
                    setCreateFailed(false);
                    setCreateOpen(true);
                  }}
                >
                  {copy.authRoleCreate}
                </AdminSecondaryButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-[19rem_minmax(0,1fr)]">
          <div
            className={`min-h-0 ${mobileEditing ? "hidden md:block" : "block"} md:h-[calc(100dvh-15rem)] md:min-h-[26rem]`}
          >
            <RoleNavigator
              roles={roles}
              counts={countMap}
              activeRoleId={activeRoleId}
              dirtyRoleIds={dirtyRoleIds}
              disabled={savingId !== null}
              capabilities={capabilities}
              strings={strings.navigator}
              onSelect={selectRole}
              onCreate={() => {
                setCreateFailed(false);
                setCreateOpen(true);
              }}
            />
          </div>
          <div
            className={`min-h-0 ${mobileEditing || activeRole === null ? "block" : "hidden"} md:block md:h-[calc(100dvh-15rem)] md:min-h-[26rem]`}
          >
            {activeRole === null || activeDraft === null ? (
              <AdminEmptyState message={strings.editor.emptySelection} />
            ) : (
              <RoleEditor
                role={activeRole}
                draft={activeDraft}
                catalog={catalog}
                totalPermissions={totalPermissions}
                dirty={activeDirty}
                saving={savingId === activeRole.id}
                partialFailure={partialFailures.has(activeRole.id)}
                capabilities={capabilities}
                fieldErrors={saveErrors ?? {}}
                strings={strings.editor}
                onPatch={(patch) => {
                  setDraftPatch(activeRole.id, patch);
                }}
                onToggleGrant={(key) => {
                  toggleGrant(activeRole.id, key);
                }}
                onSave={() => {
                  void saveRole(activeRole.id);
                }}
                onDelete={() => {
                  setDeleteTarget(activeRole);
                }}
                onBack={() => {
                  if (activeDirty) {
                    setPendingSwitch("back");

                    return;
                  }

                  setMobileEditing(false);
                }}
              />
            )}
          </div>
        </div>
      )}

      {createOpen ? (
        <CreateRoleDialog
          open
          pending={creating}
          failed={createFailed}
          strings={strings.createDialog}
          onClose={() => {
            setCreateOpen(false);
          }}
          onCreate={(input) => {
            void createRole(input);
          }}
        />
      ) : null}

      <AdminConfirmDialog
        open={deleteTarget !== null}
        title={strings.deleteDialog.title(deleteTarget?.name ?? "")}
        description={strings.deleteDialog.description}
        confirmLabel={copy.authRoleDelete}
        cancelLabel={copy.commonCancel}
        dangerous
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteRole(deleteTarget);
          }
        }}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
      />

      <AdminDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSwitch(null);
          }
        }}
        title={strings.switchDialog.title}
        description={
          pendingRole === null
            ? strings.switchDialog.descriptionBack
            : strings.switchDialog.description(pendingTargetName(roles, pendingRole))
        }
        closeLabel={copy.commonCancel}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <AdminGhostButton
              type="button"
              onClick={() => {
                setPendingSwitch(null);
              }}
            >
              {copy.commonCancel}
            </AdminGhostButton>
            <AdminGhostButton type="button" onClick={discardAndSwitch}>
              {strings.switchDialog.discard}
            </AdminGhostButton>
            <AdminSecondaryButton type="button" onClick={saveAndSwitch}>
              {strings.switchDialog.save}
            </AdminSecondaryButton>
          </div>
        }
      >
        <p className="text-sm text-muted">{strings.switchDialog.body}</p>
      </AdminDialog>
    </div>
  );
}

const pendingTargetName = (roles: ReadonlyArray<RoleEntry>, roleId: string): string =>
  roles.find((role) => role.id === roleId)?.name ?? roleId;

interface RoleStrings {
  readonly navigator: RoleNavigatorStrings;
  readonly editor: RoleEditorStrings;
  readonly createDialog: CreateRoleDialogStrings;
  readonly unsavedBadge: (count: number) => string;
  readonly switchDialog: {
    readonly title: string;
    readonly description: (name: string) => string;
    readonly descriptionBack: string;
    readonly body: string;
    readonly discard: string;
    readonly save: string;
  };
  readonly deleteDialog: {
    readonly title: (name: string) => string;
    readonly description: string;
  };
  readonly notices: {
    readonly saved: (name: string) => { readonly title: string; readonly description: string };
    readonly created: (name: string) => { readonly title: string; readonly description: string };
    readonly deleted: (name: string) => { readonly title: string; readonly description: string };
    readonly validation: { readonly title: string; readonly description: string };
    readonly saveFailed: { readonly title: string; readonly description: string };
    readonly partial: { readonly title: string; readonly description: string };
    readonly createFailed: { readonly title: string; readonly description: string };
    readonly deleteFailed: { readonly title: string; readonly description: string };
  };
}

const stringsFor = (lang: Locale, copy: ReturnType<typeof messagesFor>): RoleStrings => {
  const vi = lang === "vi";

  return {
    navigator: {
      heading: copy.authRoles,
      createRole: copy.authRoleCreate,
      system: copy.authRoleSystem,
      custom: copy.authRoleCustom,
      protectedBadge: copy.authRoleProtected,
      members: copy.authRoleMembers,
      unsaved: vi ? "chưa lưu" : "unsaved changes",
    },
    editor: {
      overview: vi ? "Tổng quan" : "Overview",
      name: copy.authRoleName,
      description: copy.authRoleDescription,
      color: copy.authRoleColor,
      colorHint: vi
        ? "Mã hex, ví dụ #3b82f6. Chọn ô màu hoặc nhập tay."
        : "Hex code, e.g. #3b82f6. Use the swatch or type it.",
      position: copy.authRolePosition,
      permissions: vi ? "Quyền" : "Permissions",
      grantsCount: (granted, total) =>
        vi ? `${granted}/${total} quyền được chọn` : `${granted} of ${total} permissions selected`,
      sensitive: vi ? "Nhạy cảm" : "Sensitive",
      system: copy.authRoleSystem,
      custom: copy.authRoleCustom,
      protectedBadge: copy.authRoleProtected,
      protectedNote: vi
        ? "Vai trò được bảo vệ: máy chủ có thể từ chối một số thay đổi."
        : "Protected role: the server may refuse some changes.",
      members: copy.authRoleMembers,
      saveChanges: vi ? "Lưu thay đổi" : "Save changes",
      saving: vi ? "Đang lưu…" : "Saving…",
      partialSaved: vi
        ? "Đã lưu thông tin vai trò, nhưng chưa lưu quyền. Kiểm tra lại rồi lưu tiếp."
        : "Role details saved, but permissions were not. Review and save again.",
      deleteRole: copy.authRoleDelete,
      deleteForbidden: copy.authRoleDeleteForbidden,
      emptySelection: vi ? "Chọn một vai trò trong danh sách." : "Select a role from the list.",
      discardChanges: vi ? "Hủy thay đổi" : "Discard changes",
      nameRequired: vi ? "Tên vai trò là bắt buộc." : "Role name is required.",
      colorInvalid: vi
        ? "Màu phải là mã hex, ví dụ #3b82f6."
        : "Color must be a hex code, e.g. #3b82f6.",
      backToList: vi ? "Danh sách" : "Roles",
    },
    createDialog: {
      title: copy.authRoleCreate,
      description: vi
        ? "Vai trò mới bắt đầu với không quyền nào; hãy gán quyền sau khi tạo."
        : "New roles start with no permissions; assign grants after creation.",
      slug: copy.authRoleSlug,
      slugHint: vi
        ? "Chữ thường, số và gạch nối, ví dụ event-host."
        : "Lowercase letters, numbers and dashes, e.g. event-host.",
      name: copy.authRoleName,
      nameHint: vi ? "Để trống để dùng slug." : "Leave blank to use the slug.",
      close: copy.commonCancel,
      create: copy.authCreate,
      creating: vi ? "Đang tạo…" : "Creating…",
      createFailed: copy.adminRoleCreateFailed,
      slugRequired: vi ? "Slug là bắt buộc." : "Slug is required.",
    },
    unsavedBadge: (count) =>
      vi
        ? `${count} vai trò chưa lưu`
        : `${count} role${count === 1 ? "" : "s"} with unsaved changes`,
    switchDialog: {
      title: vi ? "Thay đổi chưa lưu" : "Unsaved changes",
      description: (name) =>
        vi
          ? `Bạn đang sửa vai trò này và muốn chuyển sang “${name}”?`
          : `You have unsaved edits and want to switch to “${name}”?`,
      descriptionBack: vi
        ? "Bạn có thay đổi chưa lưu và muốn quay lại danh sách?"
        : "You have unsaved edits and want to go back to the list?",
      body: vi
        ? "Lưu sẽ giữ mọi chỉnh sửa; hủy sẽ xóa hết thay đổi chưa lưu."
        : "Saving keeps every edit; discarding drops all unsaved changes.",
      discard: vi ? "Hủy thay đổi" : "Discard",
      save: vi ? "Lưu rồi chuyển" : "Save and switch",
    },
    deleteDialog: {
      title: (name) => (vi ? `Xóa vai trò “${name}”?` : `Delete role “${name}”?`),
      description: copy.adminDeleteRoleConfirm,
    },
    notices: {
      saved: (name) => ({
        title: copy.authSaved,
        description: vi ? `Đã lưu vai trò “${name}”.` : `Saved role “${name}”.`,
      }),
      created: (name) => ({
        title: copy.authSaved,
        description: vi ? `Đã tạo vai trò “${name}”.` : `Created role “${name}”.`,
      }),
      deleted: (name) => ({
        title: copy.authSaved,
        description: vi ? `Đã xóa vai trò “${name}”.` : `Deleted role “${name}”.`,
      }),
      validation: {
        title: copy.authChangeFailed,
        description: vi
          ? "Kiểm tra các trường được đánh dấu rồi thử lại."
          : "Review the highlighted fields and try again.",
      },
      saveFailed: { title: copy.authChangeFailed, description: copy.adminActionFailed },
      partial: {
        title: copy.authChangeFailed,
        description: vi
          ? "Đã lưu thông tin vai trò, nhưng chưa lưu quyền. Thử lưu lại."
          : "Role details saved, but permissions were not. Save again.",
      },
      createFailed: { title: copy.authChangeFailed, description: copy.adminRoleCreateFailed },
      deleteFailed: { title: copy.authChangeFailed, description: copy.adminActionFailed },
    },
  };
};
