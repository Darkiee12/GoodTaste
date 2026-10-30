// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";

import { RoleId } from "@/modules/user/server/domain/identifiers";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { Actor } from "@/server/auth/actor";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

/**
 * Roles capability-gating contracts (Agent R3).
 *
 * Complements `tests/admin-roles.test.ts` (bounded counts, protected CRUD,
 * last-owner guard) with the shipped authorization contracts the rebuilt
 * two-pane `/admin/roles` editor depends on:
 * - read-only actors (`role:read` only) observe but never mutate;
 * - `role:manage-permissions` gates grant edits independently of
 *   `role:create/update/delete`;
 * - delegation: nobody grants permissions they do not hold themselves;
 * - failed mutations leave the catalog byte-identical (unsaved-edit
 *   preservation has a trustworthy server state to return to);
 * - system roles refuse deletion; protected roles refuse grant rewrites.
 *
 * Backend integration style: every invariant runs through the real
 * `RoleService` against PostgreSQL with isolated fixtures owned by this
 * file. No TRUNCATE, no seed-count coupling.
 */

const stamp = Date.now().toString(36);

const testAudit = { requestId: `r3-roles-${stamp}`, sessionId: null };

const actorOf = (userId: string): Actor => Actor.Member({ userId });

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const createdUserIds: Array<string> = [];
const createdRoleIds: Array<string> = [];

const makeUser = async (name: string): Promise<string> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const id = `r3-${stamp}-${name}`;
  const email = `${id}@example.com`;

  try {
    await sql`INSERT INTO "feastjourney"."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${name}, ${email}, true, now(), now()) ON CONFLICT DO NOTHING`;
  } finally {
    await sql.end();
  }

  createdUserIds.push(id);

  return id;
};

const makeRoleWithGrants = async (name: string, grants: ReadonlyArray<string>): Promise<string> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const id = `r3-${stamp}-${name}`;
  const slug = `r3-${stamp}-${name}`;

  try {
    await sql`INSERT INTO feastjourney.roles (id, slug, name) VALUES (${id}, ${slug}, ${name}) ON CONFLICT DO NOTHING`;

    await Promise.all(
      grants.map(
        (key) =>
          sql`INSERT INTO feastjourney.role_permissions (role_id, permission_key) VALUES (${id}, ${key}) ON CONFLICT DO NOTHING`,
      ),
    );
  } finally {
    await sql.end();
  }

  createdRoleIds.push(id);

  return id;
};

const grantRole = async (roleId: string, userId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    await sql`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING`;
  } finally {
    await sql.end();
  }
};

const grantsOf = async (owner: Actor, roleId: string): Promise<ReadonlyArray<string>> => {
  const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));
  const entry = catalog.roles.find((role) => role.id === roleId);

  if (entry === undefined) {
    throw new Error(`expected role ${roleId} in catalog`);
  }

  return entry.permissions.toSorted();
};

interface RoleSnapshot {
  readonly description: string;
  readonly color: string;
  readonly grants: ReadonlyArray<string>;
  readonly name: string;
  readonly position: number;
  readonly slug: string;
}

const snapshotRole = async (owner: Actor, roleId: string): Promise<RoleSnapshot> => {
  const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));
  const entry = catalog.roles.find((role) => role.id === roleId);

  if (entry === undefined) {
    throw new Error(`expected role ${roleId} in catalog`);
  }

  return {
    color: entry.color,
    description: entry.description,
    grants: entry.permissions.toSorted(),
    name: entry.name,
    position: entry.position,
    slug: entry.slug,
  };
};

const targetSlug = `r3-target-${stamp}`;
const bystanderSlug = `r3-bystander-${stamp}`;

let ownerId = "";
let readerId = "";
let editorId = "";
let granterId = "";
let targetRoleId = "";
let bystanderRoleId = "";

afterAll(async () => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    const ownedRoleIds = [targetRoleId, bystanderRoleId, ...createdRoleIds].flatMap((id) =>
      id.length > 0 ? [id] : [],
    );

    await Promise.all(
      ownedRoleIds.map((id) => sql`DELETE FROM feastjourney.user_roles WHERE role_id = ${id}`),
    );
    await sql`DELETE FROM feastjourney.roles WHERE id LIKE ${`r3-${stamp}-%`}`;

    if (createdUserIds.length > 0) {
      await sql`DELETE FROM "feastjourney"."user" WHERE id IN ${sql(createdUserIds)}`;
    }
  } finally {
    await sql.end();
  }
});

describe("roles capability gating", () => {
  test("setup: owner, limited actors, and isolated target/bystander roles", async () => {
    ownerId = await makeUser("owner");
    await grantRole("owner", ownerId);
    const owner = actorOf(ownerId);

    const readerRole = await makeRoleWithGrants("reader", ["role:read"]);

    // Editor can create/update/delete roles but may not touch grants.
    const editorRole = await makeRoleWithGrants("editor", [
      "role:read",
      "role:create",
      "role:update",
      "role:delete",
    ]);

    // Granter may edit grants but holds no publish power to delegate.
    const granterRole = await makeRoleWithGrants("granter", [
      "role:read",
      "role:manage-permissions",
      "food:read",
    ]);

    readerId = await makeUser("reader");
    editorId = await makeUser("editor");
    granterId = await makeUser("granter");
    await grantRole(readerRole, readerId);
    await grantRole(editorRole, editorId);
    await grantRole(granterRole, granterId);

    const target = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: targetSlug,
            name: "R3 Target",
            description: "mutation fixture",
            color: "#1f2937",
            position: 41,
          },
          testAudit,
        ),
      ),
    );

    targetRoleId = target.id;

    createdRoleIds.push(target.id);

    const bystander = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: bystanderSlug,
            name: "R3 Bystander",
            description: "untouched control",
            color: "#0ea5e9",
            position: 42,
          },
          testAudit,
        ),
      ),
    );

    bystanderRoleId = bystander.id;

    createdRoleIds.push(bystander.id);

    expect(targetRoleId.length).toBeGreaterThan(0);
    expect(bystanderRoleId.length).toBeGreaterThan(0);
  });

  test("read-only actor observes the catalog but mutates nothing", async () => {
    const owner = actorOf(ownerId);
    const reader = actorOf(readerId);

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(reader)));

    expect(catalog.roles.some((role) => role.slug === targetSlug)).toBe(true);

    const counts = await run(
      Effect.flatMap(RoleService, (service) => service.memberCounts(reader)),
    );

    expect(Array.isArray(counts)).toBe(true);

    const before = await snapshotRole(owner, targetRoleId);

    const deniedCreate = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          reader,
          {
            slug: `r3-denied-${stamp}`,
            name: "Denied",
            description: "",
            color: "#6b7280",
            position: 0,
          },
          testAudit,
        ),
      ),
    );

    expect(deniedCreate._tag).toBe("InsufficientPermissions");

    const deniedUpdate = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          reader,
          RoleId.parse(targetRoleId),
          {
            slug: targetSlug,
            name: "Reader Tampered",
            description: "",
            color: "#6b7280",
            position: 0,
          },
          testAudit,
        ),
      ),
    );

    expect(deniedUpdate._tag).toBe("InsufficientPermissions");

    const deniedGrants = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(reader, RoleId.parse(targetRoleId), ["food:read"], testAudit),
      ),
    );

    expect(deniedGrants._tag).toBe("InsufficientPermissions");

    const deniedDelete = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(reader, RoleId.parse(targetRoleId), testAudit),
      ),
    );

    expect(deniedDelete._tag).toBe("InsufficientPermissions");

    expect(await snapshotRole(owner, targetRoleId)).toEqual(before);
    expect(await grantsOf(owner, targetRoleId)).toEqual(before.grants);
  });

  test("guests are denied mutations with typed failures", async () => {
    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          Actor.Guest(),
          {
            slug: `r3-guest-${stamp}`,
            name: "Guest",
            description: "",
            color: "#6b7280",
            position: 0,
          },
          testAudit,
        ),
      ),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
  });

  test("grant edits require role:manage-permissions, not just role:update", async () => {
    const owner = actorOf(ownerId);
    const editor = actorOf(editorId);
    const before = await snapshotRole(owner, targetRoleId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(editor, RoleId.parse(targetRoleId), ["food:read"], testAudit),
      ),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
    expect(JSON.stringify(denied)).toMatch(/role:manage-permissions/);

    expect(await snapshotRole(owner, targetRoleId)).toEqual(before);
  });

  test("delegation: actors cannot grant permissions they do not hold", async () => {
    const owner = actorOf(ownerId);
    const granter = actorOf(granterId);
    const before = await snapshotRole(owner, targetRoleId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(granter, RoleId.parse(targetRoleId), ["food:publish"], testAudit),
      ),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
    expect(JSON.stringify(denied)).toMatch(/delegate/i);
    expect(JSON.stringify(denied)).toMatch(/food:publish/);

    // Failed grant edit preserves the existing grant set exactly.
    expect(await grantsOf(owner, targetRoleId)).toEqual(before.grants);
  });

  test("delegation positive control: held permissions grant cleanly", async () => {
    const owner = actorOf(ownerId);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse(targetRoleId), ["food:read"], testAudit),
      ),
    );

    expect(await grantsOf(owner, targetRoleId)).toEqual(["food:read"]);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse(targetRoleId), [], testAudit),
      ),
    );

    expect(await grantsOf(owner, targetRoleId)).toEqual([]);
  });

  test("protected roles refuse grant rewrites and keep their grants", async () => {
    const owner = actorOf(ownerId);
    const before = await grantsOf(owner, "owner");

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse("owner"), ["food:read"], testAudit),
      ),
    );

    expect(denied._tag).toBe("ProtectedRole");
    expect(await grantsOf(owner, "owner")).toEqual(before);
  });

  test("system roles refuse deletion and stay listed", async () => {
    const owner = actorOf(ownerId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(owner, RoleId.parse("member"), testAudit),
      ),
    );

    expect(denied._tag).toBe("RoleNotManageable");

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));

    expect(catalog.roles.some((role) => role.id === "member")).toBe(true);
  });

  test("unknown permission keys fail closed without touching grants", async () => {
    const owner = actorOf(ownerId);
    const before = await snapshotRole(owner, targetRoleId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse(targetRoleId), ["food:teleport"], testAudit),
      ),
    );

    expect(denied._tag).toBe("UnknownPermission");
    expect(await grantsOf(owner, targetRoleId)).toEqual(before.grants);
  });

  test("failed validation preserves the committed role exactly", async () => {
    const owner = actorOf(ownerId);
    const before = await snapshotRole(owner, targetRoleId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          owner,
          RoleId.parse(targetRoleId),
          {
            slug: targetSlug,
            name: "Should Never Persist",
            description: "",
            color: "not-a-color",
            position: 99,
          },
          testAudit,
        ),
      ),
    );

    expect(denied._tag).toBe("InvalidRoleAssignment");
    expect(await snapshotRole(owner, targetRoleId)).toEqual(before);
  });

  test("duplicate slug creation fails without inserting a partial row", async () => {
    const owner = actorOf(ownerId);

    const denied = await runFailure(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: targetSlug,
            name: "Duplicate",
            description: "",
            color: "#6b7280",
            position: 0,
          },
          testAudit,
        ),
      ),
    );

    expect(denied._tag).toBe("InvalidRoleAssignment");

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));

    expect(catalog.roles.filter((role) => role.slug === targetSlug)).toHaveLength(1);
  });

  test("mutating one role leaves unrelated roles byte-identical", async () => {
    const owner = actorOf(ownerId);
    const before = await snapshotRole(owner, bystanderRoleId);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.updateRole(
          owner,
          RoleId.parse(targetRoleId),
          {
            slug: targetSlug,
            name: "R3 Target Renamed",
            description: "edited while bystander watched",
            color: "#111827",
            position: 43,
          },
          testAudit,
        ),
      ),
    );

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse(targetRoleId), ["food:read"], testAudit),
      ),
    );

    // Service-level analogue of "catalog refresh keeps unrelated drafts":
    // committed work on the target never bleeds into the bystander.
    expect(await snapshotRole(owner, bystanderRoleId)).toEqual(before);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.setRoleGrants(owner, RoleId.parse(targetRoleId), [], testAudit),
      ),
    );
  });

  test("deleting an ordinary role removes it and leaves neighbors intact", async () => {
    const owner = actorOf(ownerId);
    const doomedSlug = `r3-doomed-${stamp}`;

    const created = await run(
      Effect.flatMap(RoleService, (service) =>
        service.createRole(
          owner,
          {
            slug: doomedSlug,
            name: "R3 Doomed",
            description: "",
            color: "#000000",
            position: 44,
          },
          testAudit,
        ),
      ),
    );

    createdRoleIds.push(created.id);

    const bystanderBefore = await snapshotRole(owner, bystanderRoleId);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.deleteRole(owner, RoleId.parse(created.id), testAudit),
      ),
    );

    const catalog = await run(Effect.flatMap(RoleService, (service) => service.listRoles(owner)));

    expect(catalog.roles.some((role) => role.id === created.id)).toBe(false);
    expect(await snapshotRole(owner, bystanderRoleId)).toEqual(bystanderBefore);
  });
});
