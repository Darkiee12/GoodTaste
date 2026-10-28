import { Context, Effect, Layer, Option } from "effect";

import { type RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import { InsufficientPermissions, ProtectedRole, RoleNotFound } from "@/server/auth/errors";
import { isPermissionKey } from "@/server/auth/permissions";
import type { Permission, PermissionRequest } from "@/server/auth/permissions";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

/**
 * Database-backed authorization. Effective grants are the union of the
 * permissions attached to every role the user holds; anything not granted
 * is denied. A suspended account or an unavailable authorization database
 * never gains privileges through a fallback — both fail closed.
 *
 * Ownership is a separate concern (`checkOwnership`): RBAC answers whether
 * the actor holds a capability, not whether they may touch one specific
 * resource.
 */
export class Authorization extends Context.Service<
  Authorization,
  {
    readonly permissionsOf: (
      userId: UserId,
    ) => Effect.Effect<ReadonlySet<Permission>, DatabaseError, Database | RoleRepository>;
    readonly has: (
      actor: Actor,
      request: PermissionRequest,
    ) => Effect.Effect<boolean, DatabaseError, Database | RoleRepository>;
    readonly require: (
      actor: Actor,
      request: PermissionRequest,
    ) => Effect.Effect<void, InsufficientPermissions | DatabaseError, Database | RoleRepository>;
    readonly requireManageableRole: (
      actor: Actor,
      roleId: RoleId,
    ) => Effect.Effect<
      { readonly id: string; readonly isProtected: boolean },
      RoleNotFound | ProtectedRole | InsufficientPermissions | DatabaseError,
      Database | RoleRepository
    >;
    readonly requireDelegatable: (
      actor: Actor,
      permissions: ReadonlyArray<Permission>,
    ) => Effect.Effect<void, InsufficientPermissions | DatabaseError, Database | RoleRepository>;
  }
>()("feastjourney/auth/Authorization") {}

const requestedPairs = (request: PermissionRequest): ReadonlyArray<string> =>
  request.actions.map((action) => `${request.resource}:${action}`);

/** Resolves the database identity, or nothing for guests and service actors (fail closed downstream). */
const memberUserId = (actor: Actor): Effect.Effect<Option.Option<UserId>> =>
  Actor.$match(actor, {
    Guest: () => Effect.succeed(Option.none()),
    Member: ({ userId }) => Effect.succeed(Option.some(UserId.parse(userId))),
    Admin: () => Effect.succeed(Option.none()),
  });

/** Rejects guests and service actors; members resolve to their database identity. */
const requireUserId = (actor: Actor): Effect.Effect<UserId, InsufficientPermissions> =>
  Effect.flatMap(memberUserId(actor), (maybe) =>
    Option.isNone(maybe)
      ? Effect.fail(new InsufficientPermissions({ reason: "Guests hold no permissions." }))
      : Effect.succeed(maybe.value),
  );

/** Effective grant set for one user; unknown catalog rows can never match a typed request. */
const effectiveGrants = (
  userId: UserId,
): Effect.Effect<ReadonlySet<string>, DatabaseError, Database | RoleRepository> =>
  Effect.gen(function* () {
    const repository = yield* RoleRepository;
    const rows = yield* repository.permissionsOfUser(userId);

    return new Set(rows.map((row) => row.permission_key));
  });

export const AuthorizationLive = Layer.succeed(Authorization, {
  permissionsOf: (userId) =>
    Effect.gen(function* () {
      const granted = yield* effectiveGrants(userId);
      const validated = new Set<Permission>();

      for (const key of granted) {
        if (isPermissionKey(key)) {
          validated.add(key);
        }
      }

      return validated;
    }),

  has: (actor, request) =>
    Effect.flatMap(memberUserId(actor), (maybeUserId) =>
      Option.isNone(maybeUserId)
        ? Effect.succeed(false)
        : Effect.map(effectiveGrants(maybeUserId.value), (granted) =>
            requestedPairs(request).every((pair) => granted.has(pair)),
          ),
    ),

  require: (actor, request) =>
    Effect.flatMap(requireUserId(actor), (userId) =>
      Effect.flatMap(effectiveGrants(userId), (granted) => {
        const missing = requestedPairs(request).filter((pair) => !granted.has(pair));

        if (missing.length > 0) {
          return Effect.fail(
            new InsufficientPermissions({
              reason: `Missing permissions: ${missing.join(", ")}.`,
            }),
          );
        }

        return Effect.void;
      }),
    ),

  requireManageableRole: (actor, roleId) =>
    Effect.gen(function* () {
      const userId = yield* requireUserId(actor);
      const repository = yield* RoleRepository;
      const record = yield* repository.roleById(roleId);

      if (record === null) {
        return yield* new RoleNotFound({ roleId });
      }

      const granted = yield* effectiveGrants(userId);

      if (record.is_protected && !granted.has("role:manage-protected")) {
        return yield* new ProtectedRole({ roleId });
      }

      if (!granted.has("role:update")) {
        return yield* new InsufficientPermissions({
          reason: "Missing permission: role:update.",
        });
      }

      return { id: record.id, isProtected: record.is_protected };
    }),

  requireDelegatable: (actor, permissions) =>
    Effect.flatMap(requireUserId(actor), (userId) =>
      Effect.flatMap(effectiveGrants(userId), (granted) => {
        const missing = permissions.filter((permission) => !granted.has(permission));

        if (missing.length > 0) {
          return Effect.fail(
            new InsufficientPermissions({
              reason: `Cannot delegate permissions you do not hold: ${missing.join(", ")}.`,
            }),
          );
        }

        return Effect.void;
      }),
    ),
});
