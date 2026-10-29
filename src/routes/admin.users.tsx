import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  MemberDrawer,
  MemberTable,
  failureKindOf,
  selectMember,
  type FailureKind,
} from "@/components/admin/members";
import {
  adminAssignRoleFn,
  adminBanUserFn,
  adminFindUserByEmailFn,
  adminListRolesFn,
  adminListUsersFn,
  adminRemoveRoleFn,
  adminUnbanUserFn,
  authorizeFn,
} from "@/modules/user/admin.functions";
import { getSessionFn } from "@/modules/user/session.functions";
import { messagesFor, type Locale, type Messages } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const PAGE_SIZE = 20;

export const Route = createFileRoute("/admin/users")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/admin/users", lang: search.lang } });
    }

    const { allowed } = await authorizeFn({
      data: {
        checks: [
          { resource: "user", actions: ["list"] },
          { resource: "admin", actions: ["access"] },
        ],
      },
    });

    if (!allowed) {
      throw redirect({ to: "/", search: { lang: search.lang } });
    }

    return {};
  },
  loader: async () => {
    const [users, roles, session] = await Promise.all([
      adminListUsersFn({ data: { limit: PAGE_SIZE, offset: 0 } }),
      adminListRolesFn(),
      getSessionFn(),
    ]);

    return { users, roles: roles.roles, currentUserId: session.user?.id ?? null };
  },
  component: AdminUsers,
});

interface MemberNotice {
  readonly message: string;
  readonly userId: string;
}

const describeFailure = (kind: FailureKind, lang: Locale, copy: Messages): string => {
  switch (kind) {
    case "last-owner":
      return lang === "vi"
        ? "Đây là chủ sở hữu đang hoạt động cuối cùng. Hãy chỉ định một chủ sở hữu khác trước khi gỡ hoặc tạm khóa."
        : "This is the last active owner. Assign another owner before removing or suspending them.";
    case "protected":
      return lang === "vi"
        ? "Thay đổi này liên quan đến vai trò được bảo vệ và cần quyền cao hơn. Yêu cầu đã bị từ chối ở máy chủ."
        : "That change involves a protected role and needs elevated rights. The server denied the request.";
    case "recent-auth":
      return lang === "vi"
        ? "Thao tác nhạy cảm cần một phiên đăng nhập mới. Hãy đăng xuất rồi đăng nhập lại, sau đó thử lại."
        : "Sensitive actions need a fresh sign-in. Sign out and back in, then try again.";
    case "permissions":
      return copy.authDenied;
    case "generic":
      return copy.adminActionFailed;
    default:
      return copy.adminActionFailed;
  }
};

function AdminUsers() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const initial = Route.useLoaderData();
  const queryClient = useQueryClient();
  const pageId = useId();
  const errorId = `${pageId}-error`;

  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchedEmail, setSearchedEmail] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [rolesError, setRolesError] = useState<MemberNotice | null>(null);
  const [accountError, setAccountError] = useState<MemberNotice | null>(null);
  const [announcement, setAnnouncement] = useState<MemberNotice | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", page],
    queryFn: () => adminListUsersFn({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    initialData: page === 0 ? initial.users : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });

  const rolesQuery = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => adminListRolesFn().then((result) => result.roles),
    initialData: initial.roles,
    staleTime: 60_000,
    retry: 1,
  });

  const searchQuery = useQuery({
    queryKey: ["admin", "user-search", searchedEmail],
    queryFn: () => adminFindUserByEmailFn({ data: { email: searchedEmail } }),
    enabled: searchedEmail !== "",
    staleTime: 30_000,
    retry: 1,
  });

  const manageProtectedQuery = useQuery({
    queryKey: ["admin", "capabilities", "manage-protected"],
    queryFn: () =>
      authorizeFn({
        data: { checks: [{ resource: "role", actions: ["manage-protected"] }] },
      }).then((result) => result.allowed),
    initialData: false,
    staleTime: 60_000,
    retry: 1,
  });

  const users = usersQuery.data ?? [];
  const roles = rolesQuery.data;
  const foundUser = searchedEmail === "" ? null : (searchQuery.data ?? null);
  const canManageProtected = manageProtectedQuery.data;

  const roleNameOf = (roleId: string): string =>
    roles.find((role) => role.id === roleId)?.name ?? roleId;

  const selectedMember = selectMember(users, foundUser, selectedMemberId);

  const refreshMemberCaches = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

    if (searchedEmail !== "") {
      void queryClient.invalidateQueries({ queryKey: ["admin", "user-search", searchedEmail] });
    }
  };

  const assignRole = useMutation({
    mutationFn: (input: {
      readonly email: string;
      readonly roleId: string;
      readonly userId: string;
    }) =>
      adminAssignRoleFn({ data: { user_id: input.userId, role_id: input.roleId } }).then(
        () => input,
      ),
    onSuccess: (input) => {
      setRolesError(null);
      setAnnouncement({
        userId: input.userId,
        message:
          lang === "vi"
            ? `Đã gán ${roleNameOf(input.roleId)} cho ${input.email}.`
            : `Assigned ${roleNameOf(input.roleId)} to ${input.email}.`,
      });
      refreshMemberCaches();
    },
    onError: (error, input) => {
      setRolesError({
        userId: input.userId,
        message: describeFailure(failureKindOf(error), lang, copy),
      });
    },
  });

  const removeRole = useMutation({
    mutationFn: (input: {
      readonly email: string;
      readonly roleId: string;
      readonly userId: string;
    }) =>
      adminRemoveRoleFn({ data: { user_id: input.userId, role_id: input.roleId } }).then(
        () => input,
      ),
    onSuccess: (input) => {
      setRolesError(null);
      setAnnouncement({
        userId: input.userId,
        message:
          lang === "vi"
            ? `Đã gỡ ${roleNameOf(input.roleId)} khỏi ${input.email}.`
            : `Removed ${roleNameOf(input.roleId)} from ${input.email}.`,
      });
      refreshMemberCaches();
    },
    onError: (error, input) => {
      setRolesError({
        userId: input.userId,
        message: describeFailure(failureKindOf(error), lang, copy),
      });
    },
  });

  const banUser = useMutation({
    mutationFn: (input: {
      readonly email: string;
      readonly reason: string;
      readonly userId: string;
    }) =>
      adminBanUserFn({ data: { user_id: input.userId, reason: input.reason } }).then(() => input),
    onSuccess: (input) => {
      setAccountError(null);
      setAnnouncement({
        userId: input.userId,
        message: lang === "vi" ? `Đã tạm khóa ${input.email}.` : `Suspended ${input.email}.`,
      });
      refreshMemberCaches();
    },
    onError: (error, input) => {
      setAccountError({
        userId: input.userId,
        message: describeFailure(failureKindOf(error), lang, copy),
      });
    },
  });

  const unbanUser = useMutation({
    mutationFn: (input: { readonly email: string; readonly userId: string }) =>
      adminUnbanUserFn({ data: { user_id: input.userId } }).then(() => input),
    onSuccess: (input) => {
      setAccountError(null);
      setAnnouncement({
        userId: input.userId,
        message: lang === "vi" ? `Đã mở khóa ${input.email}.` : `Restored ${input.email}.`,
      });
      refreshMemberCaches();
    },
    onError: (error, input) => {
      setAccountError({
        userId: input.userId,
        message: describeFailure(failureKindOf(error), lang, copy),
      });
    },
  });

  const openManage = (memberId: string, trigger: HTMLButtonElement): void => {
    lastTriggerRef.current = trigger;
    setRolesError(null);
    setAccountError(null);
    setAnnouncement(null);
    setSelectedMemberId(memberId);
  };

  const closeDrawer = (): void => {
    const trigger = lastTriggerRef.current;

    setSelectedMemberId(null);

    // Restore after the drawer unmounts: focusing synchronously here runs
    // while Radix's focus scope is still mounted, so the scope reclaims it
    // and focus is lost to the body. The deferred restore wins because it
    // runs after the unmount commit (and Radix's own cleanup).
    if (trigger !== null) {
      window.requestAnimationFrame(() => {
        trigger.focus();
      });
    }
  };

  const failed = usersQuery.isError || (searchedEmail !== "" && searchQuery.isError);
  const hasNextPage = users.length >= PAGE_SIZE;

  const drawerPending =
    selectedMemberId !== null &&
    ((assignRole.isPending && assignRole.variables.userId === selectedMemberId) ||
      (removeRole.isPending && removeRole.variables.userId === selectedMemberId) ||
      (banUser.isPending && banUser.variables.userId === selectedMemberId) ||
      (unbanUser.isPending && unbanUser.variables.userId === selectedMemberId));

  return (
    <div className="mx-auto w-full max-w-6xl bg-cream px-4 py-10 sm:px-8">
      <h1 className="font-display text-4xl tracking-wide text-ink">{copy.adminMembers}</h1>

      {failed ? (
        <div
          role="alert"
          id={errorId}
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p>{copy.adminActionFailed}</p>
          <button
            type="button"
            className="mt-2 font-medium underline hover:no-underline"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["admin"] });
            }}
          >
            {copy.adminRefresh}
          </button>
        </div>
      ) : null}

      <section
        aria-labelledby={`${pageId}-search-heading`}
        className="mt-4 rounded-lg border border-border-soft bg-white p-4 shadow-sm"
      >
        <h2
          id={`${pageId}-search-heading`}
          className="font-display text-2xl tracking-wide text-ink"
        >
          {copy.adminUserSearchLabel}
        </h2>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setSearchedEmail(searchInput.trim());
          }}
        >
          <label htmlFor={`${pageId}-search-email`} className="sr-only">
            {copy.adminUserSearchLabel}
          </label>
          <input
            id={`${pageId}-search-email`}
            name="memberEmail"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={searchInput}
            placeholder={copy.adminUserSearchPlaceholder}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink motion-safe:transition-colors focus:border-brand-blue"
          />
          <button
            type="submit"
            disabled={searchQuery.isFetching || searchInput.trim() === ""}
            aria-busy={searchQuery.isFetching}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.adminUserSearchButton}
          </button>
        </form>
        {searchQuery.isSuccess && searchedEmail !== "" && foundUser === null ? (
          <p className="mt-3 rounded-md border border-border-soft bg-cream px-3 py-2 text-sm text-muted">
            {copy.adminUserNotFound}
          </p>
        ) : null}
        {searchQuery.isSuccess && foundUser !== null ? (
          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft px-3 py-2">
            <span className="min-w-0 break-words text-sm font-semibold text-ink">
              {foundUser.email}
            </span>
            <button
              type="button"
              aria-label={`Manage roles and account for ${foundUser.email}`}
              title={`Manage roles and account for ${foundUser.email}`}
              onClick={(event) => {
                openManage(foundUser.id, event.currentTarget);
              }}
              className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink hover:bg-cream focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none"
            >
              <Settings2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${pageId}-browse-heading`} className="mt-6">
        <h2
          id={`${pageId}-browse-heading`}
          className="font-display text-2xl tracking-wide text-ink"
        >
          {copy.adminMembers}
        </h2>
        {usersQuery.isPending && users.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border-soft bg-white p-6 text-sm text-muted shadow-sm">
            {lang === "vi" ? "Đang tải…" : "Loading…"}
          </p>
        ) : (
          <MemberTable lang={lang} members={users} onManage={openManage} roleNameOf={roleNameOf} />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={page === 0 || usersQuery.isFetching}
            onClick={() => {
              setPage(page - 1);
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-soft bg-white px-4 text-sm font-medium text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.adminUserPrevious}
          </button>
          <button
            type="button"
            disabled={!hasNextPage || usersQuery.isFetching}
            onClick={() => {
              setPage(page + 1);
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-soft bg-white px-4 text-sm font-medium text-ink hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.adminUserNext}
          </button>
        </div>
      </section>

      <MemberDrawer
        accountError={
          selectedMember !== null &&
          accountError !== null &&
          accountError.userId === selectedMember.id
            ? accountError.message
            : null
        }
        announcement={
          selectedMember !== null &&
          announcement !== null &&
          announcement.userId === selectedMember.id
            ? announcement.message
            : null
        }
        assignPending={assignRole.isPending}
        banPending={banUser.isPending}
        canManageProtected={canManageProtected}
        copy={copy}
        currentUserId={initial.currentUserId}
        lang={lang}
        member={selectedMember}
        modalPending={drawerPending}
        onAssign={(input) => {
          if (selectedMember !== null && input.userId === selectedMember.id) {
            assignRole.mutate({
              email: selectedMember.email,
              roleId: input.roleId,
              userId: selectedMember.id,
            });
          }
        }}
        onClose={closeDrawer}
        onRemove={(input) => {
          if (selectedMember !== null && input.userId === selectedMember.id) {
            removeRole.mutate({
              email: selectedMember.email,
              roleId: input.roleId,
              userId: selectedMember.id,
            });
          }
        }}
        onRestore={(userId) => {
          if (selectedMember !== null && userId === selectedMember.id) {
            unbanUser.mutate({ email: selectedMember.email, userId: selectedMember.id });
          }
        }}
        onSuspend={(input) => {
          if (selectedMember !== null && input.userId === selectedMember.id) {
            banUser.mutate({
              email: selectedMember.email,
              reason: input.reason,
              userId: selectedMember.id,
            });
          }
        }}
        removePendingRoleId={removeRole.isPending ? removeRole.variables.roleId : null}
        roles={roles}
        rolesError={
          selectedMember !== null && rolesError !== null && rolesError.userId === selectedMember.id
            ? rolesError.message
            : null
        }
        unbanPending={unbanUser.isPending}
      />
    </div>
  );
}
