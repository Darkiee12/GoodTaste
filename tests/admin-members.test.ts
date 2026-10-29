// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { UserAdminService } from "@/modules/user/server/operations/admin-service";
import { Authorization } from "@/modules/user/server/operations/authorization";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { Actor } from "@/server/auth/actor";
import type { PermissionRequest } from "@/server/auth/permissions";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./integration/food-auth";

/**
 * Feast Lab members administration. The members page pairs the paged
 * `listUsers` query with the exact normalized-email `findUserByEmail`
 * lookup (null when absent — never an auto-created invite) and assigns
 * roles through the real services. Backend integration style: no mocks.
 */

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const stamp = Date.now().toString(36);
const testAudit = { requestId: `tlab-members-${stamp}`, sessionId: null };

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

const userRowCount = async (email: string): Promise<number> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const rows = await sql<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM "feastjourney"."user" WHERE lower(email) = lower(${email})`;

    return Number(rows[0]?.count ?? 0);
  } finally {
    await sql.end();
  }
};

describe("Feast Lab members administration", () => {
  test("exact normalized-email lookup finds a registered member", async () => {
    const member = await foodAuth.signupSignin("tmember-lookup");
    const owner = await foodAuth.signupSignin("tmember-owner");
    await foodAuth.grantRole(owner.userId, "owner");

    const found = await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.findUserByEmail(actorOf(owner.userId), member.email.toUpperCase()),
      ),
    );

    expect(found?.id).toBe(member.userId);
    expect(found?.email).toBe(member.email);
  });

  test("unknown email returns null and creates nothing", async () => {
    const owner = await foodAuth.signupSignin("tmember-owner-null");
    await foodAuth.grantRole(owner.userId, "owner");

    const missingEmail = `tlab-nobody-${stamp}@example.com`;

    const found = await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.findUserByEmail(actorOf(owner.userId), missingEmail),
      ),
    );

    expect(found).toBeNull();
    // The members page must say "no member found", never invent an invite.
    expect(await userRowCount(missingEmail)).toBe(0);
  });

  test("authorized admin assigns and removes a role with audit", async () => {
    const target = await foodAuth.signupSignin("tmember-target");
    const owner = await foodAuth.signupSignin("tmember-owner-assign");
    await foodAuth.grantRole(owner.userId, "owner");
    const admin = actorOf(owner.userId);

    const foodCreate = { resource: "food", actions: ["create"] } as const;

    expect(await hasGrant(target.userId, foodCreate)).toBe(false);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(admin, UserId.parse(target.userId), RoleId.parse("curator"), testAudit),
      ),
    );

    // Effective grants prove the assignment landed; no row-shape coupling.
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

  test("protected-role assignment is denied without manage-protected", async () => {
    const target = await foodAuth.signupSignin("tmember-target-protected");
    const adminUser = await foodAuth.signupSignin("tmember-admin");
    await foodAuth.grantRole(adminUser.userId, "admin");

    // The admin role holds everything except role:manage-protected.
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
    expect(await hasGrant(target.userId, { resource: "role", actions: ["manage-protected"] })).toBe(
      false,
    );
  });

  test("users without user:list are denied at the operation boundary", async () => {
    const plain = await foodAuth.signupSignin("tmember-plain");
    const member = actorOf(plain.userId);

    const listDenied = await runFailure(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(member, 20, 0)),
    );

    expect(listDenied._tag).toBe("InsufficientPermissions");

    const lookupDenied = await runFailure(
      Effect.flatMap(UserAdminService, (service) => service.findUserByEmail(member, plain.email)),
    );

    expect(lookupDenied._tag).toBe("InsufficientPermissions");

    const guestDenied = await runFailure(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(Actor.Guest(), 20, 0)),
    );

    expect(guestDenied._tag).toBe("InsufficientPermissions");
  });

  test("failed list queries surface typed failures, never silent empties", async () => {
    const owner = await foodAuth.signupSignin("tmember-owner-page");
    await foodAuth.grantRole(owner.userId, "owner");

    const failed = await runFailure(
      Effect.flatMap(UserAdminService, (service) =>
        service.listUsers(actorOf(owner.userId), -1, 0),
      ),
    );

    expect(failed._tag).toBe("PersistenceError");
  });

  test("member pages stay bounded and ordered", async () => {
    const owner = await foodAuth.signupSignin("tmember-owner-pages");
    await foodAuth.grantRole(owner.userId, "owner");
    const admin = actorOf(owner.userId);

    const first = await run(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(admin, 2, 0)),
    );

    const second = await run(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(admin, 2, 2)),
    );

    expect(first.length).toBeLessThanOrEqual(2);
    expect(second.length).toBeLessThanOrEqual(2);

    const firstIds = new Set(first.map((row) => row.id));
    const overlap = second.filter((row) => firstIds.has(row.id));

    expect(overlap).toEqual([]);
  });
});
