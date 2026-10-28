import { describe, expect, test } from "bun:test";

import { isPermissionKey, PERMISSION_KEYS, SYSTEM_ROLES } from "@/server/auth/permissions";
import type { Permission } from "@/server/auth/permissions";

describe("permission vocabulary", () => {
  test("covers the documented enforcement points", () => {
    for (const key of [
      "food:read",
      "food:publish",
      "restaurant:submit",
      "favorite:create",
      "favorite:delete",
      "profile:update",
      "role:create",
      "role:assign",
      "role:manage-permissions",
      "role:manage-protected",
      "user:ban",
      "user:manage-roles",
      "session:revoke-any",
      "support:read",
      "moderation:resolve",
      "admin:access",
      "audit:read",
    ] as const) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  test("rejects unknown keys so clients cannot invent grants", () => {
    expect(isPermissionKey("user:impersonate")).toBe(false);
    expect(isPermissionKey("admin:everything")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
    expect(isPermissionKey("food")).toBe(false);
  });

  test("every catalogued key is a well-formed resource:action pair", () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThan(20);

    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });

  test("the type union accepts catalogued keys", () => {
    const grant: Permission = "role:manage-protected";

    expect(isPermissionKey(grant)).toBe(true);
  });
});

describe("system roles", () => {
  test("defines exactly the seeded roles", () => {
    expect(Object.values(SYSTEM_ROLES).toSorted()).toEqual([
      "admin",
      "curator",
      "member",
      "moderator",
      "owner",
      "support",
    ]);
  });
});
