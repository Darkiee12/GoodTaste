import { Context, Effect, Layer } from "effect";

import { UserId, type RoleId } from "@/modules/user/server/domain/identifiers";
import { recordAuditEvent, type AuditContext } from "@/modules/user/server/operations/audit";
import { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRow } from "@/modules/user/server/repository/role-repository";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import type { UserRepository } from "@/modules/user/server/repository/user-repository";
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
import { isPermissionKey, PERMISSION_KEYS, SYSTEM_ROLES } from "@/server/auth/permissions";
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

/**
 * Action-level capabilities for the roles administration surface. Each flag
 * mirrors the grant the matching mutation enforces server-side, so the route
 * can render read-only versus editable controls without duplicating the
 * policy. Every flag still needs its server check at mutation time (plus
 * target system/protected rules, delegation, and recent authentication),
 * so a stale probe can only hide controls, never widen access.
 *
 * `delegatable` names the vocabulary keys the caller may grant to a role;
 * anything else must render disabled — the server rejects it with
 * `InsufficientPermissions` ("cannot delegate..."). `canManageProtected`
 * alone authorizes nothing: membership changes on protected roles need it
 * paired with `role:assign`, and protected metadata/grants stay immutable.
 */
export interface RoleCapabilities {
  readonly canRead: boolean;
  readonly canCreate: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
  readonly canAssign: boolean;
  readonly canManagePermissions: boolean;
  readonly canManageProtected: boolean;
  readonly delegatable: ReadonlyArray<string>;
  readonly nonDelegatable: ReadonlyArray<string>;
}

export const NO_ROLE_CAPABILITIES: RoleCapabilities = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canAssign: false,
  canManagePermissions: false,
  canManageProtected: false,
  delegatable: [],
  nonDelegatable: [...PERMISSION_KEYS],
};

/** Per-target rendering derived from capabilities plus role flags. */
export interface RoleAccess {
  readonly metadataEditable: boolean;
  readonly grantsEditable: boolean;
  readonly deletable: boolean;
  readonly membershipManageable: boolean;
}

/**
 * Pure per-role rendering rule. Protected targets are immutable for
 * metadata, grants, and deletion; membership on a protected target needs
 * `role:assign` paired with `role:manage-protected`. System (non-protected)
 * roles allow metadata edits but never deletion.
 */
export const describeRoleAccess = (
  capabilities: RoleCapabilities,
  role: { readonly isSystem: boolean; readonly isProtected: boolean },
): RoleAccess => ({
  metadataEditable: capabilities.canUpdate && !role.isProtected,
  grantsEditable: capabilities.canManagePermissions && !role.isProtected,
  deletable: capabilities.canDelete && !role.isSystem && !role.isProtected,
  membershipManageable:
    capabilities.canAssign && (capabilities.canManageProtected || !role.isProtected),
});

export interface SaveRoleResult {
  readonly role: RoleSummary;
  readonly permissions: ReadonlyArray<string>;
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
 * the caller holds the permission governing its own action, the target
 * role is manageable by the caller (protected roles need
 * `role:manage-protected`), and granted permissions never exceed what the
 * caller holds themselves (delegation). The mutation and its mandatory
 * audit record commit in one transaction: an audit failure rolls the
 * mutation back.
 */
export class RoleService extends Context.Service<
  RoleService,
  {
    readonly listRoles: (actor: Actor) => Effect.Effect<
      {
        readonly roles: ReadonlyArray<
          RoleSummary & { readonly permissions: ReadonlyArray<string> }
        >;
        readonly vocabulary: ReadonlyArray<string>;
      },
      InsufficientPermissions | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    /**
     * Bounded per-role member counts from a single GROUP BY query. Never
     * loads the member list; total membership can exceed any page size.
     */
    readonly memberCounts: (
      actor: Actor,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly roleId: string; readonly memberCount: number }>,
      InsufficientPermissions | DatabaseError,
      Database | RoleRepository | Authorization
    >;
    /**
     * Capability probe for the roles administration surface. Guests resolve
     * to all-false; members resolve one indexed grant query. A database
     * failure fails the probe (never all-true), so callers treat failure
     * as read-only-or-hidden, matching the server's fail-closed boundary.
     */
    readonly roleCapabilities: (
      actor: Actor,
    ) => Effect.Effect<RoleCapabilities, DatabaseError, Database | RoleRepository | Authorization>;
    /**
     * Atomic metadata-plus-grants save for one coherent Save control: both
     * halves commit in one transaction with one shared audit trail
     * (`auth.role.updated`, plus `auth.role.permissions_changed` when
     * grants are included). Pass `permissions: null` for a metadata-only
     * save (requires `role:update`); pass an array to also replace grants
     * (additionally requires `role:manage-permissions` plus delegation of
     * every granted key). Protected targets stay immutable either way.
     * Callers holding only `role:manage-permissions` must use
     * `setRoleGrants` instead — this operation always writes metadata and
     * therefore always requires `role:update`.
     */
    readonly saveRole: (
      actor: Actor,
      roleId: RoleId,
      input: RoleInput,
      permissions: ReadonlyArray<string> | null,
      audit: AuditContext,
    ) => Effect.Effect<
      SaveRoleResult,
      | RoleNotFound
      | ProtectedRole
      | RoleNotManageable
      | InsufficientPermissions
      | InvalidRoleAssignment
      | UnknownPermission
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly createRole: (
      actor: Actor,
      input: RoleInput,
      audit: AuditContext,
    ) => Effect.Effect<
      { readonly id: string },
      InsufficientPermissions | InvalidRoleAssignment | TransactionFailed | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly updateRole: (
      actor: Actor,
      roleId: RoleId,
      input: RoleInput,
      audit: AuditContext,
    ) => Effect.Effect<
      RoleSummary,
      | RoleNotFound
      | ProtectedRole
      | RoleNotManageable
      | InsufficientPermissions
      | InvalidRoleAssignment
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly deleteRole: (
      actor: Actor,
      roleId: RoleId,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      | RoleNotFound
      | ProtectedRole
      | RoleNotManageable
      | InsufficientPermissions
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly setRoleGrants: (
      actor: Actor,
      roleId: RoleId,
      permissions: ReadonlyArray<string>,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      | InsufficientPermissions
      | ProtectedRole
      | RoleNotFound
      | RoleNotManageable
      | UnknownPermission
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly assignRole: (
      actor: Actor,
      userId: UserId,
      roleId: RoleId,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      | RoleNotFound
      | ProtectedRole
      | InsufficientPermissions
      | LastOwnerRemovalDenied
      | InvalidRoleAssignment
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly removeRole: (
      actor: Actor,
      userId: UserId,
      roleId: RoleId,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      | RoleNotFound
      | ProtectedRole
      | InsufficientPermissions
      | LastOwnerRemovalDenied
      | TransactionFailed
      | DatabaseError,
      Database | RoleRepository | UserRepository | Authorization
    >;
  }
>()("feastjourney/user/RoleService") {}

export const RoleServiceLive = Layer.succeed(RoleService, {
  listRoles: (actor) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "role", actions: ["read"] });

      const roles = yield* repository.rolesList();

      const grants = yield* Effect.forEach(roles, (role) => repository.permissionsOfRole(role.id), {
        concurrency: 1,
      });

      return {
        roles: roles.map((role, index) =>
          Object.assign(toRoleSummary(role), {
            permissions: (grants[index] ?? []).map((entry) => entry.permission_key),
          }),
        ),
        vocabulary: PERMISSION_KEYS,
      };
    }),

  memberCounts: (actor) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "role", actions: ["read"] });

      const rows = yield* repository.memberCounts();

      return rows.map((row) => ({ roleId: row.role_id, memberCount: Number(row.member_count) }));
    }),

  roleCapabilities: (actor) =>
    Actor.$match(actor, {
      Guest: () => Effect.succeed(NO_ROLE_CAPABILITIES),
      Member: ({ userId }) =>
        Effect.gen(function* () {
          const authorization = yield* Authorization;
          const granted = yield* authorization.permissionsOf(UserId.parse(userId));

          const delegatable = PERMISSION_KEYS.filter(isPermissionKey).filter((key) =>
            granted.has(key),
          );

          const held = new Set<string>(delegatable);

          return {
            canRead: held.has("role:read"),
            canCreate: held.has("role:create"),
            canUpdate: held.has("role:update"),
            canDelete: held.has("role:delete"),
            canAssign: held.has("role:assign"),
            canManagePermissions: held.has("role:manage-permissions"),
            canManageProtected: held.has("role:manage-protected"),
            delegatable,
            nonDelegatable: PERMISSION_KEYS.filter((key) => !held.has(key)),
          } satisfies RoleCapabilities;
        }),
    }),

  createRole: (actor, input, audit) =>
    withTransaction(
      "user/role-create",
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

        // New custom roles start with zero grants: no baseline, no
        // inheritance. Grants are added explicitly and audited below.
        yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.created",
          outcome: "succeeded",
          resource: `role:${id}`,
          metadata: { slug: input.slug },
        });

        return { id };
      }),
    ),

  updateRole: (actor, roleId, input, audit) =>
    withTransaction(
      "user/role-update",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;

        // Action grant first: callers without `role:update` learn nothing
        // about the target (no existence/manageability oracle).
        yield* authorization.require(actor, { resource: "role", actions: ["update"] });

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

        yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.updated",
          outcome: "succeeded",
          resource: `role:${roleId}`,
          metadata: { slug: input.slug },
        });

        return toRoleSummary(updated);
      }),
    ),

  deleteRole: (actor, roleId, audit) =>
    withTransaction(
      "user/role-delete",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;

        yield* authorization.require(actor, { resource: "role", actions: ["delete"] });

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

        yield* repository.deleteRole(roleId);

        return yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.deleted",
          outcome: "succeeded",
          resource: `role:${roleId}`,
        });
      }),
    ),

  setRoleGrants: (actor, roleId, permissions, audit) =>
    withTransaction(
      "user/role-grants-replace",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;

        yield* authorization.require(actor, { resource: "role", actions: ["manage-permissions"] });

        const manageable = yield* authorization.requireManageableRole(actor, roleId);

        if (manageable.isProtected) {
          return yield* new ProtectedRole({ roleId });
        }

        const unknown = permissions.filter((permission) => !isPermissionKey(permission));

        if (unknown.length > 0) {
          return yield* new UnknownPermission({ permission: unknown[0] ?? "" });
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

        return yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.permissions_changed",
          outcome: "succeeded",
          resource: `role:${roleId}`,
          metadata: { permissions: [...wanted].join(",") },
        });
      }),
    ),

  saveRole: (actor, roleId, input, permissions, audit) =>
    withTransaction(
      "user/role-save",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;

        yield* authorization.require(actor, { resource: "role", actions: ["update"] });

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

        let savedPermissions: ReadonlyArray<string> = [];

        if (permissions !== null) {
          yield* authorization.require(actor, {
            resource: "role",
            actions: ["manage-permissions"],
          });

          const unknown = permissions.filter((permission) => !isPermissionKey(permission));

          if (unknown.length > 0) {
            return yield* new UnknownPermission({ permission: unknown[0] ?? "" });
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

          savedPermissions = [...wanted];

          yield* recordAuditEvent({
            actorUserId: actorLabel(actor),
            sessionId: audit.sessionId,
            requestId: audit.requestId,
            event: "auth.role.permissions_changed",
            outcome: "succeeded",
            resource: `role:${roleId}`,
            metadata: { permissions: [...wanted].join(",") },
          });
        } else {
          const current = yield* repository.permissionsOfRole(roleId);
          savedPermissions = current.map((entry) => entry.permission_key);
        }

        yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.updated",
          outcome: "succeeded",
          resource: `role:${roleId}`,
          metadata: { slug: input.slug },
        });

        return { role: toRoleSummary(updated), permissions: savedPermissions };
      }),
    ),

  assignRole: (actor, userId, roleId, audit) =>
    withTransaction(
      "user/role-assign",
      Effect.gen(function* () {
        const authorization = yield* Authorization;
        const repository = yield* RoleRepository;

        yield* authorization.require(actor, { resource: "role", actions: ["assign"] });

        const manageable = yield* authorization.requireManageableRole(actor, roleId);

        if (manageable.isProtected) {
          yield* authorization.require(actor, { resource: "role", actions: ["manage-protected"] });
        }

        const grants = yield* repository.permissionsOfRole(roleId);
        const valid = grants.map((entry) => entry.permission_key).filter(isPermissionKey);

        yield* authorization.requireDelegatable(actor, valid);
        yield* repository.assignRole(userId, roleId, actorLabel(actor));

        return yield* recordAuditEvent({
          actorUserId: actorLabel(actor),
          sessionId: audit.sessionId,
          requestId: audit.requestId,
          event: "auth.role.assigned",
          outcome: "succeeded",
          resource: `user:${userId}`,
          metadata: { role: roleId },
        });
      }),
    ),

  removeRole: (actor, userId, roleId, audit) =>
    // Only owner-membership changes take the guard lock: counting and
    // mutation happen inside one transaction while holding
    // `lockOwnerGuard`, so concurrent removals serialize and the second
    // one observes the first one's commit. Unrelated role changes skip
    // both the lock and the transaction entirely.
    roleId === SYSTEM_ROLES.owner
      ? withTransaction(
          "user/role-remove-owner",
          Effect.gen(function* () {
            const authorization = yield* Authorization;
            const repository = yield* RoleRepository;

            yield* authorization.require(actor, { resource: "role", actions: ["assign"] });

            const manageable = yield* authorization.requireManageableRole(actor, roleId);

            if (manageable.isProtected) {
              yield* authorization.require(actor, {
                resource: "role",
                actions: ["manage-protected"],
              });
            }

            yield* repository.lockOwnerGuard();

            const remaining = yield* repository.activeOwnerCount();

            if (remaining <= BigInt(1)) {
              const assignments = yield* repository.rolesOfUser(userId);
              const holds = assignments.some((entry) => entry.role_id === SYSTEM_ROLES.owner);

              if (holds) {
                return yield* new LastOwnerRemovalDenied({
                  reason: "cannot remove the last active owner",
                });
              }
            }

            yield* repository.removeRole(userId, roleId);

            return yield* recordAuditEvent({
              actorUserId: actorLabel(actor),
              sessionId: audit.sessionId,
              requestId: audit.requestId,
              event: "auth.role.unassigned",
              outcome: "succeeded",
              resource: `user:${userId}`,
              metadata: { role: roleId },
            });
          }),
        )
      : withTransaction(
          "user/role-remove",
          Effect.gen(function* () {
            const authorization = yield* Authorization;
            const repository = yield* RoleRepository;

            yield* authorization.require(actor, { resource: "role", actions: ["assign"] });

            const manageable = yield* authorization.requireManageableRole(actor, roleId);

            if (manageable.isProtected) {
              yield* authorization.require(actor, {
                resource: "role",
                actions: ["manage-protected"],
              });
            }

            yield* repository.removeRole(userId, roleId);

            return yield* recordAuditEvent({
              actorUserId: actorLabel(actor),
              sessionId: audit.sessionId,
              requestId: audit.requestId,
              event: "auth.role.unassigned",
              outcome: "succeeded",
              resource: `user:${userId}`,
              metadata: { role: roleId },
            });
          }),
        ),
});

const actorLabel = (actor: Actor): string | null =>
  Actor.$match(actor, {
    Guest: () => null,
    Member: ({ userId }) => userId,
  });
