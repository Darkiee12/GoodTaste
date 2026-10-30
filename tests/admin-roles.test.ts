// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { Actor } from "@/server/auth/actor";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

/**
 * Feast Lab roles administration. The roles page loads `listRoles` plus the
 * bounded `memberCounts` GROUP BY query — it never pages the member list, so
 * totals past any page size stay exact. Backend integration style: every
 * invariant runs through the real services against PostgreSQL, no mocks.
 */

const stamp = Date.now().toString(36);
const testAudit = { requestId: `tlab-roles-${stamp}`, sessionId: null };

const actorOf = (userId: string): Actor => Actor.Member({ userId });

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const createdUserIds: Array<string> = [];
const createdRoleIds: Array<string> = [];

const makeUser = async (name: string): Promise<string> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const id = `tlab-roles-${stamp}-${name}`;
  const email = `${id}@example.com`;

  await sql`INSERT INTO "feastjourney"."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${name}, ${email}, true, now(), now()) ON CONFLICT DO NOTHING`;
  await sql.end();
  createdUserIds.push(id);

  return id;
};

const grant = async (roleId: string, userId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING`;
  await sql.end();
};

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

const bigRoleSlug = `tlab-big-${stamp}`;
const emptyRoleSlug = `tlab-empty-${stamp}`;
const crudSlug = `tlab-crud-${stamp}`;

let ownerId = "";
let bigRoleId = "";
let emptyRoleId = "";

afterAll(async () => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    if (bigRoleId !== "") {
      await sql`DELETE FROM feastjourney.user_roles WHERE role_id = ${bigRoleId}`;
    }

    if (createdRoleIds.length > 0) {
      await sql`DELETE FROM feastjourney.roles WHERE id IN ${sql(createdRoleIds)}`;
    }

    if (createdUserIds.length > 0) {
      await sql`DELETE FROM "feastjourney"."user" WHERE id IN ${sql(createdUserIds)}`;
    }
  } finally {
    await sql.end();
  }
});

describe("Feast Lab roles administration", () => {
  test("setup: owner actor and fixture roles", async () => {
    ownerId = await makeUser("owner");
    await grant("owner", ownerId);
    const owner = actorOf(ownerId);

    const big = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: bigRoleSlug,
            name: "Tlab Big Role",
            description: "bounded count fixture",
            color: "#123456",
            position: 90,
          },
          testAudit,
        ),
      ),
    );

    bigRoleId = big.id;
    createdRoleIds.push(big.id);

    const empty = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: emptyRoleSlug,
            name: "Tlab Empty Role",
            description: "zero member fixture",
            color: "#654321",
            position: 91,
          },
          testAudit,
        ),
      ),
    );

    emptyRoleId = empty.id;
    createdRoleIds.push(empty.id);

    // Bulk membership past any page size. These rows are the scale
    // fixture for the bounded-count query, not the invariant under test:
    // registration itself is covered through the real handler path in
    // tests/admin-members.test.ts.
    const memberIds = Array.from({ length: 101 }, (_, index) => `tlab-big-${stamp}-m${index}`);

    createdUserIds.push(...memberIds);

    const sql = new SQL(process.env.DATABASE_URL ?? "");

    try {
      await Promise.all(
        memberIds.map(async (id) => {
          await sql`INSERT INTO "feastjourney"."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@example.com`}, true, now(), now()) ON CONFLICT DO NOTHING`;
          await sql`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${id}, ${big.id}) ON CONFLICT DO NOTHING`;
        }),
      );
    } finally {
      await sql.end();
    }

    expect(big.id.length).toBeGreaterThan(0);
    expect(empty.id.length).toBeGreaterThan(0);
  });

  test("member counts stay exact past 100 members without loading members", async () => {
    const owner = actorOf(ownerId);

    const counts = await run(Effect.flatMap(RoleService, (service) => service.memberCounts(owner)));

    const entry = counts.find((row) => row.roleId === bigRoleId);

    expect(entry?.memberCount).toBe(101);
    // Bounded: one row per role with members, never one row per member.
    expect(counts.length).toBeLessThan(101);
  });

  test("empty roles report zero through the list, never go missing", async () => {
    const owner = actorOf(ownerId);

    const [catalog, counts] = await Promise.all([
      run(Effect.flatMap(RoleService, (service) => service.listRoles(owner))),
      run(Effect.flatMap(RoleService, (service) => service.memberCounts(owner))),
    ]);

    const listed = catalog.roles.find((role) => role.slug === emptyRoleSlug);

    expect(listed).toBeDefined();

    const countEntry = counts.find((row) => row.roleId === emptyRoleId);

    // GROUP BY only returns roles with members; the page maps absence to
    // zero rather than dropping the role.
    expect(countEntry).toBeUndefined();

    const byId = new Map(counts.map((row) => [row.roleId, row.memberCount] as const));
    const displayed = catalog.roles.map((role) => byId.get(role.id) ?? 0);
    const emptyIndex = catalog.roles.findIndex((role) => role.slug === emptyRoleSlug);

    expect(displayed[emptyIndex]).toBe(0);
  });

  test("guests get typed denials, never silent empty lists", async () => {
    const deniedList = await runFailure(
      Effect.flatMap(RoleService, (service) => service.listRoles(Actor.Guest())),
    );

    expect(deniedList._tag).toBe("InsufficientPermissions");

    const deniedCounts = await runFailure(
      Effect.flatMap(RoleService, (service) => service.memberCounts(Actor.Guest())),
    );

    expect(deniedCounts._tag).toBe("InsufficientPermissions");
  });

  test("create and update persist through the real service with audit", async () => {
    const owner = actorOf(ownerId);

    const created = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: crudSlug,
            name: "Tlab Crud",
            description: "create fixture",
            color: "#abcdef",
            position: 92,
          },
          testAudit,
        ),
      ),
    );

    createdRoleIds.push(created.id);

    expect(await auditCount("auth.role.created", `role:${created.id}`)).toBe(1);

    const updated = await run(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          owner,
          RoleId.parse(created.id),
          {
            slug: crudSlug,
            name: "Tlab Crud Renamed",
            description: "updated fixture",
            color: "#fedcba",
            position: 93,
          },
          testAudit,
        ),
      ),
    );

    expect(updated.name).toBe("Tlab Crud Renamed");
    expect(updated.color).toBe("#fedcba");
    expect(await auditCount("auth.role.updated", `role:${created.id}`)).toBe(1);

    const duplicate = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: crudSlug,
            name: "Tlab Crud Duplicate",
            description: "",
            color: "#000000",
            position: 94,
          },
          testAudit,
        ),
      ),
    );

    expect(duplicate._tag).toBe("InvalidRoleAssignment");
  });

  test("protected roles refuse updates and deletes with typed failures", async () => {
    const owner = actorOf(ownerId);

    const adminId = await makeUser("admin");
    await grant("admin", adminId);
    const admin = actorOf(adminId);

    // The admin role holds every grant except role:manage-protected.
    const adminDenied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          admin,
          RoleId.parse("owner"),
          {
            slug: "owner",
            name: "Owner Tampered",
            description: "",
            color: "#111827",
            position: 100,
          },
          testAudit,
        ),
      ),
    );

    expect(adminDenied._tag).toBe("ProtectedRole");

    const adminDeleteDenied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(admin, RoleId.parse("owner"), testAudit),
      ),
    );

    expect(adminDeleteDenied._tag).toBe("ProtectedRole");

    // Even the owner cannot rewrite or drop the protected owner role
    // itself: protection is structural, not a missing-grant problem.
    const ownerUpdateDenied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          owner,
          RoleId.parse("owner"),
          {
            slug: "owner",
            name: "Owner Tampered",
            description: "",
            color: "#111827",
            position: 100,
          },
          testAudit,
        ),
      ),
    );

    expect(ownerUpdateDenied._tag).toBe("ProtectedRole");

    const ownerDeleteDenied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(owner, RoleId.parse("owner"), testAudit),
      ),
    );

    expect(ownerDeleteDenied._tag).toBe("ProtectedRole");

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));

    expect(catalog.roles.find((role) => role.slug === "owner")?.isProtected).toBe(true);
  });

  test("deleting an ordinary role succeeds and is audited", async () => {
    const owner = actorOf(ownerId);

    const created = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: `tlab-doomed-${stamp}`,
            name: "Tlab Doomed",
            description: "",
            color: "#000000",
            position: 95,
          },
          testAudit,
        ),
      ),
    );

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(owner, RoleId.parse(created.id), testAudit),
      ),
    );

    expect(await auditCount("auth.role.deleted", `role:${created.id}`)).toBe(1);

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));

    expect(catalog.roles.some((role) => role.id === created.id)).toBe(false);
  });

  test("removing the last owner is denied with a typed failure and no audit", async () => {
    const owner = actorOf(ownerId);
    const probe = new SQL(process.env.DATABASE_URL ?? "");

    const previous = await probe<
      Array<{ user_id: string }>
    >`SELECT user_id FROM feastjourney.user_roles WHERE role_id = 'owner' AND user_id <> ${ownerId}`;

    await probe`DELETE FROM feastjourney.user_roles WHERE role_id = 'owner' AND user_id <> ${ownerId}`;
    await probe.end();

    const deniedBefore = await auditCount("auth.role.unassigned", `user:${ownerId}`);

    try {
      const denied = await runFailure(
        Effect.flatMap(RoleService, (service) =>
          service.removeRole(owner, UserId.parse(ownerId), RoleId.parse("owner"), testAudit),
        ),
      );

      expect(denied._tag).toBe("LastOwnerRemovalDenied");

      const counts = await run(
        Effect.flatMap(RoleService, (service) => service.memberCounts(owner)),
      );

      expect(counts.find((row) => row.roleId === "owner")?.memberCount).toBe(1);
      expect(await auditCount("auth.role.unassigned", `user:${ownerId}`)).toBe(deniedBefore);
    } finally {
      const restore = new SQL(process.env.DATABASE_URL ?? "");

      try {
        await Promise.all(
          previous.map(
            (row) =>
              restore`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${row.user_id}, 'owner') ON CONFLICT DO NOTHING`,
          ),
        );
      } finally {
        await restore.end();
      }
    }
  });
});
