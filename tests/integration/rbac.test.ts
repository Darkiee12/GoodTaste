// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { UserAdminService } from "@/modules/user/server/operations/admin-service";
import { Authorization } from "@/modules/user/server/operations/authorization";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import { appRuntime } from "@/server/runtime";

const uid = (id: string): UserId => UserId.parse(id);
const rid = (id: string): RoleId => RoleId.parse(id);
const actorOf = (userId: string): Actor => Actor.Member({ userId });

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

const has = (userId: string, resource: string, actions: Array<string>): Promise<boolean> =>
  appRuntime.runPromise(
    Effect.flatMap(Authorization, (authorization) =>
      authorization.has(actorOf(userId), { resource, actions }),
    ),
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

    expect(await has(userId, "food", ["read"])).toBe(true);
    expect(await has(userId, "favorite", ["create", "delete"])).toBe(true);
    expect(await has(userId, "user", ["ban"])).toBe(false);
    expect(await has(userId, "admin", ["access"])).toBe(false);
    expect(await has(userId, "role", ["assign"])).toBe(false);
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
        service.createRole(owner, {
          slug,
          name: "Test Editor",
          description: "rules engine test role",
          color: "#123456",
          position: 15,
        }),
      ),
    );

    const memberId = await makeUser("editor");
    await grant("member", memberId);
    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(owner, uid(memberId), rid(created.id)),
      ),
    );

    expect(await has(memberId, "food", ["update"])).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["food:update", "food:publish"]),
      ),
    );

    expect(await has(memberId, "food", ["update", "publish"])).toBe(true);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["food:update"]),
      ),
    );

    expect(await has(memberId, "food", ["publish"])).toBe(false);
    expect(await has(memberId, "food", ["update"])).toBe(true);
  });

  test("unknown permission keys are rejected, never granted", async () => {
    const ownerId = await makeUser("owner2");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const slug = roleSlug("weird");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(owner, {
          slug,
          name: "Weird",
          description: "",
          color: "#000000",
          position: 16,
        }),
      ),
    );

    const rejected = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["user:impersonate", "nope"]),
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
          service.createRole(owner, {
            slug: roleSlug(suffix),
            name: suffix,
            description: "",
            color: "#000000",
            position: 20,
          }),
        ),
      );

      await appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.setRoleGrants(owner, rid(created.id), grants),
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

    expect(await has(userId, "food", ["update"])).toBe(true);
    expect(await has(userId, "restaurant", ["verify"])).toBe(true);
    expect(await has(userId, "food", ["publish"])).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) => service.removeRole(owner, uid(userId), rid(first))),
    );

    expect(await has(userId, "food", ["update"])).toBe(false);
    expect(await has(userId, "restaurant", ["verify"])).toBe(true);
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
        service.setRoleGrants(actorOf(moderatorId), rid("moderator"), ["user:ban"]),
      ),
    );

    expect(modDenied._tag).toBe("Failure");

    const supDenied = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(actorOf(supportId), uid(moderatorId), rid("admin")),
      ),
    );

    expect(supDenied._tag).toBe("Failure");

    const supRead = await has(supportId, "user", ["read"]);

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
        service.createRole(owner, {
          slug: roleSlug("junior-admin"),
          name: "Junior",
          description: "",
          color: "#000000",
          position: 31,
        }),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(juniorRole.id), [
          "role:update",
          "role:assign",
          "role:manage-permissions",
          "user:ban",
        ]),
      ),
    );
    await grant(juniorRole.id, juniorId);
    const junior = actorOf(juniorId);

    const slug = roleSlug("limited-admin");

    const created = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(owner, {
          slug,
          name: "Limited",
          description: "",
          color: "#000000",
          position: 30,
        }),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["user:ban"]),
      ),
    );

    const overreach = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(junior, rid(created.id), ["user:ban", "admin:access"]),
      ),
    );

    expect(overreach._tag).toBe("Failure");

    const allowed = await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(junior, rid(created.id), ["user:ban"]),
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
      Effect.flatMap(RoleService, (service) => service.deleteRole(pleb, rid("owner"))),
    );

    expect(deleteProtected._tag).toBe("Failure");

    const removeProtected = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(pleb, uid(ownerId), rid("owner")),
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
        service.removeRole(owner, uid(ownerId), rid("owner")),
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
        service.createRole(setup, {
          slug: roleSlug("guard"),
          name: "Race Guard",
          description: "",
          color: "#000000",
          position: 60,
        }),
      ),
    );

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(setup, rid(guardRole.id), [
          "role:update",
          "role:assign",
          "role:manage-protected",
        ]),
      ),
    );

    const guardId = await makeUser("race-guard");
    await grant(guardRole.id, guardId);
    const actor = actorOf(guardId);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(setup, uid(setupId), rid("owner")),
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
            service.removeRole(actor, uid(ownerA), rid("owner")),
          ).pipe(
            Effect.as(true),
            Effect.catchTag("LastOwnerRemovalDenied", () => Effect.succeed(false)),
          ),
        ),
        appRuntime.runPromise(
          Effect.flatMap(RoleService, (service) =>
            service.removeRole(actor, uid(ownerB), rid("owner")),
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
        Effect.flatMap(UserAdminService, (service) => service.banUser(actor, uid(ownerE), "probe")),
      );

      // D is now the last active owner: banning D must fail.
      const denied = await appRuntime.runPromiseExit(
        Effect.flatMap(UserAdminService, (service) => service.banUser(actor, uid(ownerD), "probe")),
      );

      expect(denied._tag).toBe("Failure");

      const stillActive = await appRuntime.runPromise(
        Effect.flatMap(RoleRepository, (repository) => repository.activeOwnerCount()),
      );

      expect(stillActive).toBe(BigInt(1));

      await appRuntime.runPromise(
        Effect.flatMap(UserAdminService, (service) => service.unbanUser(actor, uid(ownerE))),
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

  test("concurrent assignments of the same role are idempotent", async () => {
    const ownerId = await makeUser("owner7");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const userId = await makeUser("racer");
    await grant("member", userId);

    await Promise.all([
      appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.assignRole(owner, uid(userId), rid("curator")),
        ),
      ),
      appRuntime.runPromise(
        Effect.flatMap(RoleService, (service) =>
          service.assignRole(owner, uid(userId), rid("curator")),
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
        service.createRole(owner, {
          slug,
          name: "Live",
          description: "",
          color: "#000000",
          position: 40,
        }),
      ),
    );

    const userId = await makeUser("liveuser");
    await grant("member", userId);
    await grant(created.id, userId);

    expect(await has(userId, "restaurant", ["verify"])).toBe(false);

    await appRuntime.runPromise(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, rid(created.id), ["restaurant:verify"]),
      ),
    );

    expect(await has(userId, "restaurant", ["verify"])).toBe(true);
  });
});
