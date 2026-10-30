// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import postgres from "postgres";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { UserAdminService } from "@/modules/user/server/operations/admin-service";
import { Authorization, AuthorizationLive } from "@/modules/user/server/operations/authorization";
import { RoleService } from "@/modules/user/server/operations/role-service";
import {
  RoleRepository,
  RoleRepositoryLive,
} from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import type { PermissionRequest } from "@/server/auth/permissions";
import { Database } from "@/server/database/client";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

const uid = (id: string): UserId => UserId.parse(id);
const rid = (id: string): RoleId => RoleId.parse(id);
const actorOf = (userId: string): Actor => Actor.Member({ userId });

const testAudit = { requestId: "test-request", sessionId: null };

const allows = <A, R extends AppServices>(effect: Effect.Effect<A, unknown, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const denies = async <A, R extends AppServices>(
  effect: Effect.Effect<A, unknown, R>,
): Promise<void> => {
  const exit = await appRuntime.runPromiseExit(effect);

  expect(exit._tag).toBe("Failure");
};

const stamp = Date.now().toString(36).slice(0, 8);
const roleSlug = (name: string): string => `role-test-${name}-${stamp}`;

const createdUsers: Array<string> = [];

const makeUser = async (name: string): Promise<string> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const id = `test-user-${name}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${id}@example.com`;

  await sql`INSERT INTO "feastjourney"."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${name}, ${email}, true, now(), now()) ON CONFLICT DO NOTHING`;
  await sql.end();
  createdUsers.push(id);

  return id;
};

const grant = async (roleId: string, userId: string, by: string | null = null): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.user_roles (user_id, role_id, assigned_by) VALUES (${userId}, ${roleId}, ${by}) ON CONFLICT DO NOTHING`;
  await sql.end();
};

const has = (userId: string, request: PermissionRequest): Promise<boolean> =>
  appRuntime.runPromise(
    Effect.flatMap(Authorization, (authorization) => authorization.has(actorOf(userId), request)),
  );

afterAll(async () => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await Promise.all([
    ...createdUsers.map((id) => sql`DELETE FROM "feastjourney"."user" WHERE id = ${id}`),
    sql`DELETE FROM feastjourney.roles WHERE id LIKE 'role_test_%' OR slug LIKE 'role-test-%'`,
  ]);
  await sql.end();
});

describe("dynamic authorization", () => {
  test("new users receive member access and nothing else", async () => {
    // The database trigger assigns Member on user creation; the test must
    // not manufacture the invariant it verifies, so no manual grant here.
    const userId = await makeUser("plain");

    expect(await has(userId, { resource: "food", actions: ["read"] })).toBe(true);
    expect(await has(userId, { resource: "favorite", actions: ["create", "delete"] })).toBe(true);
    expect(await has(userId, { resource: "user", actions: ["ban"] })).toBe(false);
    expect(await has(userId, { resource: "admin", actions: ["access"] })).toBe(false);
    expect(await has(userId, { resource: "role", actions: ["assign"] })).toBe(false);
  });

  test("guests hold no permissions", async () => {
    const denied = await appRuntime.runPromise(
      Effect.flatMap(Authorization, (authorization) =>
        authorization.require(Actor.Guest(), { resource: "food", actions: ["read"] }),
      ).pipe(Effect.flip),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
  });

  test("created roles start empty; grants apply without redeploy", async () => {
    const ownerId = await makeUser("owner");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const slug = roleSlug("editor");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug,
            name: "Test Editor",
            description: "rules engine test role",
            color: "#123456",
            position: 15,
          },
          testAudit,
        ),
      ),
    );

    // No baseline grants: a fresh custom role authorizes nothing, not even
    // the role catalog itself.
    const initial = await appRuntime.runPromise(
      Effect.flatMap(RoleRepository, (repository) => repository.permissionsOfRole(created.id)),
    );

    expect(initial.length).toBe(0);

    const memberId = await makeUser("editor");
    await grant("member", memberId);
    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(owner, uid(memberId), rid(created.id), testAudit),
      ),
    );

    expect(await has(memberId, { resource: "food", actions: ["update"] })).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["food:update", "food:publish"], testAudit),
      ),
    );

    expect(await has(memberId, { resource: "food", actions: ["update", "publish"] })).toBe(true);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["food:update"], testAudit),
      ),
    );

    expect(await has(memberId, { resource: "food", actions: ["publish"] })).toBe(false);
    expect(await has(memberId, { resource: "food", actions: ["update"] })).toBe(true);
  });

  test("role permissions are enforced independently, never conflated", async () => {
    const ownerId = await makeUser("matrix-owner");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const makeRoleWith = async (suffix: string, grants: ReadonlyArray<string>): Promise<string> => {
      const created = await appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.createRole(
            owner,
            {
              slug: roleSlug(suffix),
              name: suffix,
              description: "",
              color: "#123456",
              position: 70,
            },
            testAudit,
          ),
        ),
      );

      await appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.setRoleGrants(owner, rid(created.id), [...grants], testAudit),
        ),
      );

      return created.id;
    };

    const holderFor = async (suffix: string, grants: ReadonlyArray<string>): Promise<Actor> => {
      const roleId = await makeRoleWith(`matrix-${suffix}`, grants);
      const userId = await makeUser(`matrix-${suffix}`);
      await grant(roleId, userId);

      return actorOf(userId);
    };

    const targetId = await makeRoleWith("matrix-target", []);

    // role:create alone authorizes creation and nothing else.
    const creator = await holderFor("creator", ["role:create"]);

    await allows(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          creator,
          {
            slug: roleSlug("matrix-made"),
            name: "Made",
            description: "",
            color: "#123456",
            position: 71,
          },
          testAudit,
        ),
      ),
    );

    await denies(Effect.flatMap(RoleService, (service) => service.listRoles(creator)));

    // role:read alone authorizes listing and nothing else.
    const reader = await holderFor("reader", ["role:read"]);

    await allows(Effect.flatMap(RoleService, (service) => service.listRoles(reader)));

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          reader,
          {
            slug: roleSlug("matrix-nope"),
            name: "Nope",
            description: "",
            color: "#123456",
            position: 72,
          },
          testAudit,
        ),
      ),
    );

    // role:update alone authorizes metadata edits but not assignment.
    const updater = await holderFor("updater", ["role:update"]);

    await allows(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          updater,
          rid(targetId),
          {
            slug: roleSlug("matrix-target"),
            name: "Renamed",
            description: "",
            color: "#123456",
            position: 73,
          },
          testAudit,
        ),
      ),
    );

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(updater, uid(ownerId), rid(targetId), testAudit),
      ),
    );

    // role:assign alone authorizes assignment of a manageable empty role
    // but not metadata edits, deletion, or grant changes.
    const assigner = await holderFor("assigner", ["role:assign"]);
    const assigneeId = await makeUser("matrix-assignee");

    await allows(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(assigner, uid(assigneeId), rid(targetId), testAudit),
      ),
    );

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          assigner,
          rid(targetId),
          {
            slug: roleSlug("matrix-target"),
            name: "Renamed",
            description: "",
            color: "#123456",
            position: 74,
          },
          testAudit,
        ),
      ),
    );

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(assigner, rid(targetId), testAudit),
      ),
    );

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(assigner, rid(targetId), [], testAudit),
      ),
    );

    // role:manage-permissions alone authorizes grant replacement but cannot
    // delegate what the actor lacks.
    const granter = await holderFor("granter", ["role:manage-permissions"]);

    await allows(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(granter, rid(targetId), [], testAudit),
      ),
    );

    await denies(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(granter, rid(targetId), ["user:ban"], testAudit),
      ),
    );

    // role:delete alone authorizes deletion of an eligible role.
    const deleter = await holderFor("deleter", ["role:delete"]);
    const doomedId = await makeRoleWith("matrix-doomed", []);

    await allows(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(deleter, rid(doomedId), testAudit),
      ),
    );

    // Plain members cannot even list roles.
    const plainId = await makeUser("matrix-plain");

    await denies(Effect.flatMap(RoleService, (service) => service.listRoles(actorOf(plainId))));
  });

  test("unknown permission keys are rejected, never granted", async () => {
    const ownerId = await makeUser("owner2");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const slug = roleSlug("weird");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug,
            name: "Weird",
            description: "",
            color: "#000000",
            position: 16,
          },
          testAudit,
        ),
      ),
    );

    const rejected = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["user:impersonate", "nope"], testAudit),
      ),
    );

    expect(rejected._tag).toBe("Failure");
  });

  test("effective permissions are the union across multiple roles", async () => {
    const ownerId = await makeUser("owner3");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const makeRole = async (suffix: string, grants: ReadonlyArray<string>): Promise<string> => {
      const created = await appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.createRole(
            owner,
            {
              slug: roleSlug(suffix),
              name: suffix,
              description: "",
              color: "#000000",
              position: 20,
            },
            testAudit,
          ),
        ),
      );

      await appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.setRoleGrants(owner, rid(created.id), grants, testAudit),
        ),
      );

      return created.id;
    };

    const first = await makeRole("a", ["food:update"]);
    const second = await makeRole("b", ["restaurant:verify"]);

    const userId = await makeUser("multi");
    await grant("member", userId);
    await grant(first, userId);
    await grant(second, userId);

    expect(await has(userId, { resource: "food", actions: ["update"] })).toBe(true);
    expect(await has(userId, { resource: "restaurant", actions: ["verify"] })).toBe(true);
    expect(await has(userId, { resource: "food", actions: ["publish"] })).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(owner, uid(userId), rid(first), testAudit),
      ),
    );

    expect(await has(userId, { resource: "food", actions: ["update"] })).toBe(false);
    expect(await has(userId, { resource: "restaurant", actions: ["verify"] })).toBe(true);
  });

  test("moderators cannot administer and support cannot escalate", async () => {
    const ownerId = await makeUser("owner4");
    await grant("owner", ownerId);

    const moderatorId = await makeUser("mod");
    await grant("member", moderatorId);
    await grant("moderator", moderatorId);

    const supportId = await makeUser("sup");
    await grant("member", supportId);
    await grant("support", supportId);

    const modDenied = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(actorOf(moderatorId), rid("moderator"), ["user:ban"], testAudit),
      ),
    );

    expect(modDenied._tag).toBe("Failure");

    const supDenied = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(actorOf(supportId), uid(moderatorId), rid("admin"), testAudit),
      ),
    );

    expect(supDenied._tag).toBe("Failure");

    const supRead = await has(supportId, { resource: "user", actions: ["list"] });

    expect(supRead).toBe(true);
  });

  test("managers cannot grant what they do not hold", async () => {
    const ownerId = await makeUser("owner5");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const juniorId = await makeUser("junior");
    await grant("member", juniorId);

    const juniorRole = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: roleSlug("junior-admin"),
            name: "Junior",
            description: "",
            color: "#000000",
            position: 31,
          },
          testAudit,
        ),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(
          owner,
          rid(juniorRole.id),
          ["role:update", "role:assign", "role:manage-permissions", "user:ban"],
          testAudit,
        ),
      ),
    );
    await grant(juniorRole.id, juniorId);
    const junior = actorOf(juniorId);

    const slug = roleSlug("limited-admin");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug,
            name: "Limited",
            description: "",
            color: "#000000",
            position: 30,
          },
          testAudit,
        ),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["user:ban"], testAudit),
      ),
    );

    const overreach = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(junior, rid(created.id), ["user:ban", "admin:access"], testAudit),
      ),
    );

    expect(overreach._tag).toBe("Failure");

    const allowed = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(junior, rid(created.id), ["user:ban"], testAudit),
      ).pipe(Effect.as(true)),
    );

    expect(allowed).toBe(true);
  });

  test("protected roles resist unprivileged edits and the last owner stays", async () => {
    const ownerId = await makeUser("owner6");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const plebId = await makeUser("pleb");
    await grant("member", plebId);
    const pleb = actorOf(plebId);

    const deleteProtected = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) => service.deleteRole(pleb, rid("owner"), testAudit)),
    );

    expect(deleteProtected._tag).toBe("Failure");

    const removeProtected = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(pleb, uid(ownerId), rid("owner"), testAudit),
      ),
    );

    expect(removeProtected._tag).toBe("Failure");

    const sql = new SQL(process.env.DATABASE_URL ?? "");

    const previous = await sql<
      Array<{ user_id: string }>
    >`SELECT user_id FROM feastjourney.user_roles WHERE role_id = 'owner' AND user_id <> ${ownerId}`;

    await sql`DELETE FROM feastjourney.user_roles WHERE role_id = 'owner' AND user_id <> ${ownerId}`;
    await sql.end();

    const lastOwnerGuard = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(owner, uid(ownerId), rid("owner"), testAudit),
      ),
    );

    expect(lastOwnerGuard._tag).toBe("Failure");

    const restore = new SQL(process.env.DATABASE_URL ?? "");

    await Promise.all(
      previous.map(
        (row) =>
          restore`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${row.user_id}, 'owner') ON CONFLICT DO NOTHING`,
      ),
    );

    await restore.end();
  });

  test("concurrent owner removals cannot eliminate the last owner", async () => {
    const ownerA = await makeUser("race-a");
    const ownerB = await makeUser("race-b");
    await grant("owner", ownerA);
    await grant("owner", ownerB);

    // Setup owner: removed before the race so exactly two active owners
    // remain. The race actor is NOT an owner: it holds a custom guard role
    // with just enough grants to manage owner membership.
    const setupId = await makeUser("race-setup");
    await grant("owner", setupId);
    const setup = actorOf(setupId);

    const guardRole = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          setup,
          {
            slug: roleSlug("guard"),
            name: "Race Guard",
            description: "",
            color: "#000000",
            position: 60,
          },
          testAudit,
        ),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(
          setup,
          rid(guardRole.id),
          ["role:update", "role:assign", "role:manage-protected"],
          testAudit,
        ),
      ),
    );

    const guardId = await makeUser("race-guard");
    await grant(guardRole.id, guardId);
    const actor = actorOf(guardId);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(setup, uid(setupId), rid("owner"), testAudit),
      ),
    );

    // Isolate the race: raw SQL bypasses the guard protocol, so record and
    // remove every other owner assignment, then restore them in `finally`.
    const probe = new SQL(process.env.DATABASE_URL ?? "");

    const previous = await probe<
      Array<{ user_id: string }>
    >`SELECT user_id FROM feastjourney.user_roles WHERE role_id = 'owner'`;

    const previousIds = previous
      .map((row) => row.user_id)
      .filter((id) => id !== ownerA && id !== ownerB);

    await probe`DELETE FROM feastjourney.user_roles WHERE role_id = 'owner'`;
    await probe.end();
    await grant("owner", ownerA);
    await grant("owner", ownerB);

    try {
      // Exactly one removal must win: the loser fails specifically with
      // LastOwnerRemovalDenied. Any other failure (or two successes)
      // rejects or breaks the assertion below.
      const outcomes = await Promise.all([
        appRuntime.runPromise(
          Effect.flatMap(RoleService, (service) =>
            service.removeRole(actor, uid(ownerA), rid("owner"), testAudit),
          ).pipe(
            Effect.as(true),
            Effect.catchTag("LastOwnerRemovalDenied", () => Effect.succeed(false)),
          ),
        ),
        appRuntime.runPromise(
          Effect.flatMap(RoleService, (service) =>
            service.removeRole(actor, uid(ownerB), rid("owner"), testAudit),
          ).pipe(
            Effect.as(true),
            Effect.catchTag("LastOwnerRemovalDenied", () => Effect.succeed(false)),
          ),
        ),
      ]);

      expect(outcomes.filter((won) => won).length).toBe(1);

      // Database agrees with the returned outcomes: exactly one removal won.
      const check = new SQL(process.env.DATABASE_URL ?? "");

      const holders = await check<
        Array<{ user_id: string }>
      >`SELECT user_id FROM feastjourney.user_roles WHERE role_id = 'owner' ORDER BY user_id`;

      const holderIds = holders.map((row) => row.user_id);

      expect(holderIds.length).toBe(1);
      expect(holderIds.filter((id) => id === ownerA || id === ownerB).length).toBe(1);

      const active = await appRuntime.runPromise(
        Effect.flatMap(RoleRepository, (repository) => repository.activeOwnerCount()),
      );

      expect(active).toBe(BigInt(1));
      await check.end();
    } finally {
      const restore = new SQL(process.env.DATABASE_URL ?? "");

      await Promise.all(
        previousIds.map(
          (id) =>
            restore`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${id}, 'owner') ON CONFLICT DO NOTHING`,
        ),
      );
      await restore.end();
    }
  });

  test("the last active owner cannot be banned", async () => {
    const ownerD = await makeUser("ban-actor");
    const ownerE = await makeUser("ban-target");
    await grant("owner", ownerD);
    await grant("owner", ownerE);
    const actor = actorOf(ownerD);

    const probe = new SQL(process.env.DATABASE_URL ?? "");

    const previous = await probe<
      Array<{ user_id: string }>
    >`SELECT user_id FROM feastjourney.user_roles WHERE role_id = 'owner'`;

    const previousIds = previous
      .map((row) => row.user_id)
      .filter((id) => id !== ownerD && id !== ownerE);

    await probe`DELETE FROM feastjourney.user_roles WHERE role_id = 'owner'`;
    await probe.end();
    await grant("owner", ownerD);
    await grant("owner", ownerE);

    try {
      // E is not the last active owner (D is active), so banning succeeds.
      await appRuntime.runPromise(
        Effect.flatMap(UserAdminService, (service) =>
          service.banUser(actor, uid(ownerE), "probe", testAudit),
        ),
      );

      // D is now the last active owner: banning D must fail.
      const denied = await appRuntime.runPromiseExit(
        Effect.flatMap(UserAdminService, (service) =>
          service.banUser(actor, uid(ownerD), "probe", testAudit),
        ),
      );

      expect(denied._tag).toBe("Failure");

      const stillActive = await appRuntime.runPromise(
        Effect.flatMap(RoleRepository, (repository) => repository.activeOwnerCount()),
      );

      expect(stillActive).toBe(BigInt(1));

      await appRuntime.runPromise(
        Effect.flatMap(UserAdminService, (service) =>
          service.unbanUser(actor, uid(ownerE), testAudit),
        ),
      );
    } finally {
      const restore = new SQL(process.env.DATABASE_URL ?? "");

      await Promise.all(
        previousIds.map(
          (id) =>
            restore`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${id}, 'owner') ON CONFLICT DO NOTHING`,
        ),
      );
      await restore.end();
    }
  });

  test("revoking a protected account's sessions needs manage-protected", async () => {
    const ownerId = await makeUser("revoke-owner");
    await grant("owner", ownerId);

    const adminId = await makeUser("revoke-admin");
    await grant("admin", adminId);
    const admin = actorOf(adminId);

    // Administrators hold session:revoke-any but not role:manage-protected,
    // so revoking an owner's sessions is denied at the target check.
    const denied = await appRuntime.runPromiseExit(
      Effect.flatMap(UserAdminService, (service) =>
        service.revokeUserSessions(admin, uid(ownerId), testAudit),
      ),
    );

    expect(denied._tag).toBe("Failure");

    // Revoking an ordinary member's sessions still succeeds.
    const memberId = await makeUser("revoke-member");

    await appRuntime.runPromise(
      Effect.flatMap(UserAdminService, (service) =>
        service.revokeUserSessions(admin, uid(memberId), testAudit),
      ),
    );
  });

  test("a failed audit insert rolls the privileged mutation back", async () => {
    const ownerId = await makeUser("audit-owner");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: roleSlug("audit-target"),
            name: "Audit Target",
            description: "",
            color: "#123456",
            position: 80,
          },
          testAudit,
        ),
      ),
    );

    const sql = new SQL(process.env.DATABASE_URL ?? "");

    const before = await sql<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM feastjourney.role_permissions WHERE role_id = ${created.id}`;

    // Inject an audit failure that the mutation cannot survive: a
    // NOT VALID check constraint rejects every audit insert without
    // scanning existing rows.
    await sql`ALTER TABLE feastjourney.security_audit_events ADD CONSTRAINT audit_test_must_fail CHECK (false) NOT VALID`;

    try {
      const failed = await appRuntime.runPromiseExit(
        Effect.flatMap(RoleService, (service) =>
          service.setRoleGrants(owner, rid(created.id), ["food:update"], testAudit),
        ),
      );

      expect(failed._tag).toBe("Failure");

      const after = await sql<
        Array<{ count: string }>
      >`SELECT COUNT(*) AS count FROM feastjourney.role_permissions WHERE role_id = ${created.id}`;

      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await sql`ALTER TABLE feastjourney.security_audit_events DROP CONSTRAINT audit_test_must_fail`;
      await sql.end();
    }

    // The success case writes exactly one audit record for the mutation.
    const audit = new SQL(process.env.DATABASE_URL ?? "");

    const eventsBefore = await audit<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM feastjourney.security_audit_events WHERE event = 'auth.role.permissions_changed' AND resource = ${`role:${created.id}`}`;

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["food:update"], testAudit),
      ),
    );

    const eventsAfter = await audit<
      Array<{ count: string }>
    >`SELECT COUNT(*) AS count FROM feastjourney.security_audit_events WHERE event = 'auth.role.permissions_changed' AND resource = ${`role:${created.id}`}`;

    await audit.end();

    expect(Number(eventsAfter[0]?.count ?? 0) - Number(eventsBefore[0]?.count ?? 0)).toBe(1);
  });

  test("concurrent assignments of the same role are idempotent", async () => {
    const ownerId = await makeUser("owner7");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const userId = await makeUser("racer");
    await grant("member", userId);

    await Promise.all([
      appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.assignRole(owner, uid(userId), rid("curator"), testAudit),
        ),
      ),
      appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.assignRole(owner, uid(userId), rid("curator"), testAudit),
        ),
      ),
    ]);

    const sql = new SQL(process.env.DATABASE_URL ?? "");

    const rows = await sql<
      { count: string }[]
    >`SELECT COUNT(*) AS count FROM feastjourney.user_roles WHERE user_id = ${userId} AND role_id = 'curator'`;

    await sql.end();

    expect(rows[0]?.count).toBe("1");
  });

  test("existing sessions honor changed grants without re-login", async () => {
    const ownerId = await makeUser("owner8");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const slug = roleSlug("live");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug,
            name: "Live",
            description: "",
            color: "#000000",
            position: 40,
          },
          testAudit,
        ),
      ),
    );

    const userId = await makeUser("liveuser");
    await grant("member", userId);
    await grant(created.id, userId);

    expect(await has(userId, { resource: "restaurant", actions: ["verify"] })).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["restaurant:verify"], testAudit),
      ),
    );

    expect(await has(userId, { resource: "restaurant", actions: ["verify"] })).toBe(true);
  });
});

describe("authorization fails closed without the database", () => {
  test("permission checks surface DatabaseUnavailable instead of granting", async () => {
    const down = postgres("postgres://127.0.0.1:1/unused", { max: 1, connect_timeout: 2 });

    try {
      const broken = Layer.mergeAll(
        AuthorizationLive,
        RoleRepositoryLive,
        Layer.succeed(Database, { sql: down }),
      );

      const runtime = ManagedRuntime.make(broken);

      try {
        const failure = await runtime.runPromise(
          Effect.flip(
            Effect.flatMap(Authorization, (authorization) =>
              authorization.require(actorOf("anyone"), {
                resource: "food",
                actions: ["read"],
              }),
            ),
          ),
        );

        // An unreachable authorization database must never read as an empty
        // grant set or an anonymous guest: the typed failure propagates.
        expect(failure._tag).toBe("DatabaseUnavailable");
      } finally {
        await runtime.dispose();
      }
    } finally {
      await down.end();
    }
  });
});
