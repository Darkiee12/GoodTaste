import { describe, expect, test } from "bun:test";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import type { Permission } from "@/server/auth/permissions";

const acceptUser = (id: UserId): string => id;
const acceptRole = (id: RoleId): string => id;
const assignments: Array<[UserId, RoleId]> = [];

const assignRole = (userId: UserId, roleId: RoleId): void => {
  assignments.push([userId, roleId]);
};

describe("nominal identifiers", () => {
  test("UserId and RoleId do not interchange", () => {
    const userId = UserId.parse("user-1");
    const roleId = RoleId.parse("role-1");

    expect(acceptUser(userId)).toBe("user-1");
    expect(acceptRole(roleId)).toBe("role-1");

    // @ts-expect-error RoleId is not assignable to UserId.
    expect(acceptUser(roleId)).toBe("role-1");

    // @ts-expect-error UserId is not assignable to RoleId.
    expect(acceptRole(userId)).toBe("user-1");
  });

  test("role assignment rejects swapped identifiers", () => {
    const userId = UserId.parse("user-1");
    const roleId = RoleId.parse("role-1");

    assignRole(userId, roleId);

    // @ts-expect-error arguments are in the wrong order.
    assignRole(roleId, userId);

    expect(assignments[0]).toEqual([userId, roleId]);
  });
});

describe("permission vocabulary", () => {
  test("only catalogued literals type-check", () => {
    const allowed: Permission = "role:manage-protected";

    expect(allowed).toBe("role:manage-protected");

    // @ts-expect-error unknown grants are not valid permissions.
    const invalid: Permission = "user:impersonate";

    expect([invalid].length).toBe(1);
  });
});
