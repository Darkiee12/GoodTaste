// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect, Layer } from "effect";

import {
  availableRoles,
  compactRoleSummary,
  displayNameOf,
  failureKindOf,
  isPrivilegedRole,
  selectMember,
  textOnRoleColor,
  type MemberRow,
  type RoleRow,
} from "@/components/admin/members/member-types";
import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { UserAdminService } from "@/modules/user/server/operations/admin-service";
import { Authorization } from "@/modules/user/server/operations/authorization";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import type { Permission, PermissionRequest } from "@/server/auth/permissions";
import { requireRecentAuthentication } from "@/server/auth/session";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./integration/food-auth";

/**
 * Feast Lab members drawer data flow. The drawer keeps a single selected
 * member id as principal state and derives everything else from the member
 * list plus the exact email search — never from per-row copies — so the
 * suites below pin the invariants the UI relies on: selection can never
 * resolve a stale member, denied mutations falsify nothing, permission and
 * last-owner guards hold server-side, every mutation is audited, and
 * sensitive operations still demand a fresh sign-in.
 */

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const stamp = Date.now().toString(36);
const testAudit = { requestId: `tlab-drawer-${stamp}`, sessionId: null };

const actorOf = (userId: string): Actor => Actor.Member({ userId });

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const hasGrant = (userId: string, request: PermissionRequest): Promise<boolean> =>
  run(
    Effect.flatMap(Authorization, (authorization) => authorization.has(actorOf(userId), request)),
  );

const auditCount = async (event: string, resource: string): Promise<number> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const rows = await sql<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM feastjourney.security_audit_events WHERE event = ${event} AND resource = ${resource}`;

    return Number(rows[0]?.count ?? 0);
  } finally {
    await sql.end();
  }
};

const auditMetadataReason = async (event: string, resource: string): Promise<string | null> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const rows = await sql<
      Array<{ reason: string | null }>
    >`SELECT (metadata#>>'{}')::jsonb->>'reason' AS reason FROM feastjourney.security_audit_events WHERE event = ${event} AND resource = ${resource} ORDER BY id DESC LIMIT 1`;

    return rows[0]?.reason ?? null;
  } finally {
    await sql.end();
  }
};

const banStateOf = async (userId: string): Promise<{ banned: boolean; reason: string | null }> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const rows = await sql<
      Array<{ banned: boolean; reason: string | null }>
    >`SELECT COALESCE(banned, false) AS banned, "banReason" AS reason FROM "feastjourney"."user" WHERE id = ${userId}`;

    return { banned: rows[0]?.banned ?? false, reason: rows[0]?.reason ?? null };
  } finally {
    await sql.end();
  }
};

const ownerRoleHeld = async (userId: string): Promise<boolean> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const rows = await sql<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM feastjourney.user_roles WHERE user_id = ${userId} AND role_id = ${"owner"}`;

    return Number(rows[0]?.count ?? 0) > 0;
  } finally {
    await sql.end();
  }
};

const memberRow = (overrides: Partial<MemberRow> & Pick<MemberRow, "email" | "id">): MemberRow => ({
  banned: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  name: "",
  roles: [],
  ...overrides,
});

const roleRow = (overrides: Partial<RoleRow> & Pick<RoleRow, "id" | "name">): RoleRow => ({
  color: "#2563eb",
  description: "",
  isProtected: false,
  isSystem: false,
  permissions: [],
  position: 0,
  slug: overrides.id,
  ...overrides,
});

describe("members drawer selection", () => {
  test("resolves the selected member from list or search, never a stale read", () => {
    const alice = memberRow({ email: "alice@example.com", id: "user-alice", name: "Alice" });
    const bob = memberRow({ email: "bob@example.com", id: "user-bob" });

    expect(selectMember([alice, bob], null, "user-bob")).toBe(bob);
    expect(selectMember([alice], bob, "user-bob")).toBe(bob);

    // A search that resolved for Alice must not leak into Bob's drawer.
    expect(selectMember([alice, bob], alice, "user-bob")).toBe(bob);

    // Unknown ids resolve to nothing instead of a guessed member.
    expect(selectMember([alice, bob], alice, "user-nobody")).toBeNull();
    expect(selectMember([alice, bob], alice, null)).toBeNull();
  });

  test("display names fall back to the email prefix, never a bare email", () => {
    expect(displayNameOf(memberRow({ email: "sam@example.com", id: "u1", name: "Sam" }))).toBe(
      "Sam",
    );
    expect(displayNameOf(memberRow({ email: "sam@example.com", id: "u1", name: "  " }))).toBe(
      "sam",
    );
    expect(compactRoleSummary(["Owner", "Curator", "Admin", "Member"])).toBe(
      "Owner · Curator · +2",
    );
    expect(compactRoleSummary(["Owner"])).toBe("Owner");
  });

  test("add-role options exclude held and unmanageable protected roles", () => {
    const owner = roleRow({ id: "owner", isProtected: true, name: "Owner", slug: "owner" });
    const curator = roleRow({ id: "curator", name: "Curator" });

    expect(availableRoles([owner, curator], ["curator"], true)).toEqual([owner]);
    expect(availableRoles([owner, curator], [], false)).toEqual([curator]);
    expect(isPrivilegedRole(owner)).toBe(true);
    expect(isPrivilegedRole(curator)).toBe(false);
    expect(textOnRoleColor("#ffffff")).toBe("#172033");
    expect(textOnRoleColor("#102a52")).toBe("#ffffff");
  });

  test("server rejections map to safe drawer failure kinds", () => {
    expect(failureKindOf(new Error("LastOwnerRemovalDenied: cannot remove"))).toBe("last-owner");
    expect(failureKindOf(new Error("ProtectedRole: needs manage-protected"))).toBe("protected");
    expect(failureKindOf(new Error("RecentAuthenticationRequired: stale"))).toBe("recent-auth");
    expect(failureKindOf(new Error("InsufficientPermissions: nope"))).toBe("permissions");
    expect(failureKindOf(new Error("boom"))).toBe("generic");
  });
});

describe("members drawer mutations", () => {
  test("authorized assign and remove audit every change", async () => {
    const target = await foodAuth.signupSignin("tdrawer-target");
    const owner = await foodAuth.signupSignin("tdrawer-owner");
    await foodAuth.grantRole(owner.userId, "owner");
    const admin = actorOf(owner.userId);

    const foodCreate = { resource: "food", actions: ["create"] } as const;

    expect(await hasGrant(target.userId, foodCreate)).toBe(false);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(admin, UserId.parse(target.userId), RoleId.parse("curator"), testAudit),
      ),
    );

    expect(await hasGrant(target.userId, foodCreate)).toBe(true);
    expect(await auditCount("auth.role.assigned", `user:${target.userId}`)).toBe(1);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(admin, UserId.parse(target.userId), RoleId.parse("curator"), testAudit),
      ),
    );

    expect(await hasGrant(target.userId, foodCreate)).toBe(false);
    expect(await auditCount("auth.role.unassigned", `user:${target.userId}`)).toBe(1);
  });

  test("protected-role grants are denied server-side and change nothing", async () => {
    const target = await foodAuth.signupSignin("tdrawer-protected");
    const adminUser = await foodAuth.signupSignin("tdrawer-admin");
    await foodAuth.grantRole(adminUser.userId, "admin");

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(
          actorOf(adminUser.userId),
          UserId.parse(target.userId),
          RoleId.parse("owner"),
          testAudit,
        ),
      ),
    );

    expect(denied._tag).toBe("ProtectedRole");
    expect(await ownerRoleHeld(target.userId)).toBe(false);
    expect(await hasGrant(target.userId, { resource: "role", actions: ["manage-protected"] })).toBe(
      false,
    );
    expect(await auditCount("auth.role.assigned", `user:${target.userId}`)).toBe(0);
  });

  test("suspend stores the audit reason and restore reopens access", async () => {
    const target = await foodAuth.signupSignin("tdrawer-suspend");
    const owner = await foodAuth.signupSignin("tdrawer-suspender");
    await foodAuth.grantRole(owner.userId, "owner");
    const admin = actorOf(owner.userId);

    await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.banUser(admin, UserId.parse(target.userId), "drawer test reason", testAudit),
      ),
    );

    const suspended = await banStateOf(target.userId);

    expect(suspended.banned).toBe(true);
    expect(suspended.reason).toBe("drawer test reason");
    expect(await auditCount("auth.user.banned", `user:${target.userId}`)).toBe(1);
    expect(await auditMetadataReason("auth.user.banned", `user:${target.userId}`)).toBe(
      "drawer test reason",
    );

    await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.unbanUser(admin, UserId.parse(target.userId), testAudit),
      ),
    );

    const restored = await banStateOf(target.userId);

    expect(restored.banned).toBe(false);
    expect(await auditCount("auth.user.unbanned", `user:${target.userId}`)).toBe(1);
  });

  test("ban without user:ban is denied and leaves the account active", async () => {
    const target = await foodAuth.signupSignin("tdrawer-bantarget");
    const plain = await foodAuth.signupSignin("tdrawer-plain");

    const denied = await runFailure(
      Effect.flatMap(UserAdminService, (service) =>
        service.banUser(actorOf(plain.userId), UserId.parse(target.userId), "nope", testAudit),
      ),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
    expect((await banStateOf(target.userId)).banned).toBe(false);
    expect(await auditCount("auth.user.banned", `user:${target.userId}`)).toBe(0);
  });

  test("removing the last active owner is denied and mutates nothing", async () => {
    const target = await foodAuth.signupSignin("tdrawer-lastowner");
    const owner = await foodAuth.signupSignin("tdrawer-owneractor");
    await foodAuth.grantRole(target.userId, "owner");
    await foodAuth.grantRole(owner.userId, "owner");

    const realRepository = await run(
      Effect.flatMap(RoleRepository, (repository) => Effect.succeed(repository)),
    );

    const singleOwnerRepository = Layer.succeed(RoleRepository, {
      activeOwnerCount: () => Effect.succeed(BigInt(1)),
      assignRole: (userId, roleId, assignedBy) =>
        realRepository.assignRole(userId, roleId, assignedBy),
      banUser: (userId, reason) => realRepository.banUser(userId, reason),
      deleteSessionsOfUser: (userId) => realRepository.deleteSessionsOfUser(userId),
      deleteRole: (roleId) => realRepository.deleteRole(roleId),
      findUserByEmail: (email) => realRepository.findUserByEmail(email),
      grantPermission: (roleId, permission) => realRepository.grantPermission(roleId, permission),
      insertRole: (input) => realRepository.insertRole(input),
      isUserBanned: (userId) => realRepository.isUserBanned(userId),
      lockOwnerGuard: () => Effect.void,
      memberCounts: () => realRepository.memberCounts(),
      ownerCount: () => realRepository.ownerCount(),
      permissionsOfRole: (roleId) => realRepository.permissionsOfRole(roleId),
      permissionsOfUser: (userId) => realRepository.permissionsOfUser(userId),
      removeRole: (userId, roleId) => realRepository.removeRole(userId, roleId),
      revokePermission: (roleId, permission) => realRepository.revokePermission(roleId, permission),
      roleById: (roleId) => realRepository.roleById(roleId),
      rolesList: () => realRepository.rolesList(),
      rolesOfUser: (userId) => realRepository.rolesOfUser(userId),
      unbanUser: (userId) => realRepository.unbanUser(userId),
      updateRole: (input) => realRepository.updateRole(input),
      usersList: (limit, offset) => realRepository.usersList(limit, offset),
    });

    const permissiveAuthorization = Layer.succeed(Authorization, {
      has: () => Effect.succeed(false),
      permissionsOf: () => Effect.succeed(new Set<Permission>()),
      require: () => Effect.void,
      requireDelegatable: () => Effect.void,
      requireManageableRole: () => Effect.succeed({ id: "owner", isProtected: true }),
    });

    const denied = await appRuntime.runPromise(
      Effect.flip(
        Effect.flatMap(RoleService, (service) =>
          service.removeRole(
            actorOf(owner.userId),
            UserId.parse(target.userId),
            RoleId.parse("owner"),
            testAudit,
          ),
        ).pipe(Effect.provide(singleOwnerRepository), Effect.provide(permissiveAuthorization)),
      ),
    );

    expect(denied._tag).toBe("LastOwnerRemovalDenied");
    expect(await ownerRoleHeld(target.userId)).toBe(true);
  });

  test("banning the last active owner is denied and mutates nothing", async () => {
    const target = await foodAuth.signupSignin("tdrawer-lastban");
    const owner = await foodAuth.signupSignin("tdrawer-bannactor");
    await foodAuth.grantRole(target.userId, "owner");
    await foodAuth.grantRole(owner.userId, "owner");

    const realRepository = await run(
      Effect.flatMap(RoleRepository, (repository) => Effect.succeed(repository)),
    );

    const singleOwnerRepository = Layer.succeed(RoleRepository, {
      activeOwnerCount: () => Effect.succeed(BigInt(1)),
      assignRole: (userId, roleId, assignedBy) =>
        realRepository.assignRole(userId, roleId, assignedBy),
      banUser: (userId, reason) => realRepository.banUser(userId, reason),
      deleteSessionsOfUser: (userId) => realRepository.deleteSessionsOfUser(userId),
      deleteRole: (roleId) => realRepository.deleteRole(roleId),
      findUserByEmail: (email) => realRepository.findUserByEmail(email),
      grantPermission: (roleId, permission) => realRepository.grantPermission(roleId, permission),
      insertRole: (input) => realRepository.insertRole(input),
      isUserBanned: () => Effect.succeed(false),
      lockOwnerGuard: () => Effect.void,
      memberCounts: () => realRepository.memberCounts(),
      ownerCount: () => realRepository.ownerCount(),
      permissionsOfRole: (roleId) => realRepository.permissionsOfRole(roleId),
      permissionsOfUser: (userId) => realRepository.permissionsOfUser(userId),
      removeRole: (userId, roleId) => realRepository.removeRole(userId, roleId),
      revokePermission: (roleId, permission) => realRepository.revokePermission(roleId, permission),
      roleById: (roleId) => realRepository.roleById(roleId),
      rolesList: () => realRepository.rolesList(),
      rolesOfUser: (userId) => realRepository.rolesOfUser(userId),
      unbanUser: (userId) => realRepository.unbanUser(userId),
      updateRole: (input) => realRepository.updateRole(input),
      usersList: (limit, offset) => realRepository.usersList(limit, offset),
    });

    const permissiveAuthorization = Layer.succeed(Authorization, {
      has: () => Effect.succeed(false),
      permissionsOf: () => Effect.succeed(new Set<Permission>()),
      require: () => Effect.void,
      requireDelegatable: () => Effect.void,
      requireManageableRole: () => Effect.succeed({ id: "owner", isProtected: true }),
    });

    const denied = await appRuntime.runPromise(
      Effect.flip(
        Effect.flatMap(UserAdminService, (service) =>
          service.banUser(actorOf(owner.userId), UserId.parse(target.userId), "last owner", {
            requestId: `tlab-drawer-ban-${stamp}`,
            sessionId: null,
          }),
        ).pipe(Effect.provide(singleOwnerRepository), Effect.provide(permissiveAuthorization)),
      ),
    );

    expect(denied._tag).toBe("LastOwnerRemovalDenied");
    expect((await banStateOf(target.userId)).banned).toBe(false);
    expect(await ownerRoleHeld(target.userId)).toBe(true);
  });

  test("sensitive mutations require a fresh sign-in", async () => {
    const fresh = {
      email: "fresh@example.com",
      name: "Fresh",
      sessionCreatedAt: new Date(),
      sessionId: "session-fresh",
      userId: "user-fresh",
    };

    const freshResult = await Effect.runPromise(
      Effect.as(requireRecentAuthentication(fresh), "ok"),
    );

    expect(freshResult).toBe("ok");

    const stale = {
      ...fresh,
      sessionCreatedAt: new Date(Date.now() - 16 * 60 * 1000),
    };

    const denied = await Effect.runPromise(Effect.flip(requireRecentAuthentication(stale)));

    expect(denied._tag).toBe("RecentAuthenticationRequired");
  });
});
