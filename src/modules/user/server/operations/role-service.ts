import { Context, Effect, Layer } from "effect";

import type { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRow } from "@/modules/user/server/repository/role-repository";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import {
  type InsufficientPermissions,
  InvalidRoleAssignment,
  LastOwnerRemovalDenied,
  ProtectedRole,
  RoleNotFound,
  RoleNotManageable,
  UnknownPermission,
} from "@/server/auth/errors";
import { isPermissionKey, SYSTEM_ROLES } from "@/server/auth/permissions";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import type { TransactionFailed } from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";

export interface RoleInput {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly position: number;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const validateInput = (input: RoleInput): Effect.Effect<void, InvalidRoleAssignment> => {
  if (!SLUG_PATTERN.test(input.slug)) {
    return Effect.fail(new InvalidRoleAssignment({ reason: `invalid slug "${input.slug}"` }));
  }

  if (input.name.trim().length === 0 || input.name.length > 80) {
    return Effect.fail(new InvalidRoleAssignment({ reason: "name must be 1-80 characters" }));
  }

  if (!COLOR_PATTERN.test(input.color)) {
    return Effect.fail(new InvalidRoleAssignment({ reason: `invalid color "${input.color}"` }));
  }

  return Effect.void;
};

export interface RoleSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly position: number;
  readonly isSystem: boolean;
  readonly isProtected: boolean;
}

const toRoleSummary = (row: RoleRow): RoleSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  color: row.color,
  position: row.position,
  isSystem: row.is_system,
  isProtected: row.is_protected,
});

const generateRoleId = Effect.sync(
  () =>
    `role_${[...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
);

/**
 * Role and assignment management. Every mutation enforces three layers:
 * the caller holds the governing permission, the target role is manageable
 * by the caller (protected roles need `role:manage-protected`), and granted
 * permissions never exceed what the caller holds themselves (delegation).
 * Grant replacement and owner-count checks run inside one transaction so a
 * concurrent change cannot slip between check and write.
 */
export class RoleService extends Context.Service<
  RoleService,
  {
    readonly listRoles: () => Effect.Effect<
      ReadonlyArray<RoleSummary & { readonly permissions: ReadonlyArray<string> }>,
      DatabaseError,
      Database | RoleRepository
    >;
    readonly createRole: (
      actor: Actor,
      input: RoleInput,
    ) => Effect.Effect<
      { readonly id: string },
      InsufficientPermissions | InvalidRoleAssignment | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    readonly updateRole: (
      actor: Actor,
      roleId: RoleId,
      input: RoleInput,
    ) => Effect.Effect<
      RoleSummary,
      | RoleNotFound
      | ProtectedRole
      | RoleNotManageable
      | InsufficientPermissions
      | InvalidRoleAssignment
      | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    readonly deleteRole: (
      actor: Actor,
      roleId: RoleId,
    ) => Effect.Effect<
      void,
      RoleNotFound | ProtectedRole | RoleNotManageable | InsufficientPermissions | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    readonly setRoleGrants: (
      actor: Actor,
      roleId: RoleId,
      permissions: ReadonlyArray<string>,
    ) => Effect.Effect<
      void,
      | InsufficientPermissions
      | ProtectedRole
      | RoleNotFound
      | RoleNotManageable
      | UnknownPermission
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    readonly assignRole: (
      actor: Actor,
      userId: UserId,
      roleId: RoleId,
    ) => Effect.Effect<
      void,
      | RoleNotFound
      | ProtectedRole
      | InsufficientPermissions
      | LastOwnerRemovalDenied
      | InvalidRoleAssignment
      | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    readonly removeRole: (
      actor: Actor,
      userId: UserId,
      roleId: RoleId,
    ) => Effect.Effect<
      void,
      | RoleNotFound
      | ProtectedRole
      | InsufficientPermissions
      | LastOwnerRemovalDenied
      | DatabaseError,
      Database | RoleRepository | Authorization
    >;
  }
>()("feastjourney/user/RoleService") {}

export const RoleServiceLive = Layer.succeed(RoleService, {
  listRoles: () =>
    Effect.gen(function* () {
      const repository = yield* RoleRepository;
      const roles = yield* repository.rolesList();

      const grants = yield* Effect.forEach(roles, (role) => repository.permissionsOfRole(role.id), {
        concurrency: 1,
      });

      return roles.map((role, index) =>
        Object.assign(toRoleSummary(role), {
          permissions: (grants[index] ?? []).map((entry) => entry.permission_key),
        }),
      );
    }),

  createRole: (actor, input) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "role", actions: ["create"] });
      yield* validateInput(input);

      const id = yield* generateRoleId;

      yield* Effect.catchTag(
        repository.insertRole({ id, ...input }),
        "PersistenceConflict",
        () => new InvalidRoleAssignment({ reason: `slug "${input.slug}" is taken` }),
      );

      yield* repository.grantPermission(id, "role:read");

      return { id };
    }),

  updateRole: (actor, roleId, input) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;
      const manageable = yield* authorization.requireManageableRole(actor, roleId);

      if (manageable.isProtected) {
        return yield* new ProtectedRole({ roleId });
      }

      yield* validateInput(input);

      const updated = yield* Effect.catchTag(
        repository.updateRole({ id: roleId, ...input }),
        "PersistenceConflict",
        () => new InvalidRoleAssignment({ reason: `slug "${input.slug}" is taken` }),
      );

      if (updated === null) {
        return yield* new RoleNotFound({ roleId });
      }

      return toRoleSummary(updated);
    }),

  deleteRole: (actor, roleId) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;
      const manageable = yield* authorization.requireManageableRole(actor, roleId);

      if (manageable.isProtected) {
        return yield* new ProtectedRole({ roleId });
      }

      const record = yield* repository.roleById(roleId);

      if (record !== null && record.is_system) {
        return yield* new RoleNotManageable({
          roleId,
          reason: "system roles cannot be deleted, only unassigned",
        });
      }

      return yield* repository.deleteRole(roleId);
    }),

  setRoleGrants: (actor, roleId, permissions) =>
    withTransaction(
      "user/role-grants-replace",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;
        const manageable = yield* authorization.requireManageableRole(actor, roleId);

        if (manageable.isProtected) {
          yield* new ProtectedRole({ roleId });
        }

        yield* authorization.require(actor, { resource: "role", actions: ["manage-permissions"] });

        const unknown = permissions.filter((permission) => !isPermissionKey(permission));

        if (unknown.length > 0) {
          yield* new UnknownPermission({ permission: unknown[0] ?? "" });
        }

        const valid = permissions.filter(isPermissionKey);
        yield* authorization.requireDelegatable(actor, valid);

        const current = yield* repository.permissionsOfRole(roleId);
        const wanted = new Set<string>(valid);

        for (const entry of current) {
          if (!wanted.has(entry.permission_key)) {
            yield* repository.revokePermission(roleId, entry.permission_key);
          }
        }

        for (const permission of wanted) {
          yield* repository.grantPermission(roleId, permission);
        }
      }),
    ),

  assignRole: (actor, userId, roleId) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;
      const manageable = yield* authorization.requireManageableRole(actor, roleId);

      yield* authorization.require(actor, { resource: "role", actions: ["assign"] });

      if (manageable.isProtected) {
        yield* authorization.require(actor, { resource: "role", actions: ["manage-protected"] });
      }

      const grants = yield* repository.permissionsOfRole(roleId);
      const valid = grants.map((entry) => entry.permission_key).filter(isPermissionKey);

      yield* authorization.requireDelegatable(actor, valid);

      return yield* repository.assignRole(userId, roleId, actorLabel(actor));
    }),

  removeRole: (actor, userId, roleId) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;
      const manageable = yield* authorization.requireManageableRole(actor, roleId);

      yield* authorization.require(actor, { resource: "role", actions: ["assign"] });

      if (manageable.isProtected) {
        yield* authorization.require(actor, { resource: "role", actions: ["manage-protected"] });
      }

      if (roleId === SYSTEM_ROLES.owner) {
        const remaining = yield* repository.ownerCount();

        if (remaining <= BigInt(1)) {
          const assignments = yield* repository.rolesOfUser(userId);
          const holds = assignments.some((entry) => entry.role_id === SYSTEM_ROLES.owner);

          if (holds) {
            return yield* new LastOwnerRemovalDenied({
              reason: "cannot remove the last owner",
            });
          }
        }
      }

      return yield* repository.removeRole(userId, roleId);
    }),
});

const actorLabel = (actor: Actor): string | null =>
  Actor.$match(actor, {
    Guest: () => null,
    Member: ({ userId }) => userId,
    Admin: () => null,
  });
