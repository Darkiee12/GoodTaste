import { Context, Effect, Layer } from "effect";

import type { UserId } from "@/modules/user/server/domain/identifiers";
import { Authorization } from "@/modules/user/server/operations/authorization";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import type { Actor } from "@/server/auth/actor";
import { type InsufficientPermissions } from "@/server/auth/errors";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

export interface AdminUserSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly banned: boolean;
  readonly createdAt: string;
  readonly roles: ReadonlyArray<string>;
}

type AdminFailure = InsufficientPermissions | DatabaseError;

/**
 * User account administration behind dynamic RBAC. All reads and writes go
 * through application-owned Reylo queries; Better Auth's plugin admin
 * endpoints are locked down to empty grants and never called, so no static
 * role check can bypass these guards.
 */
export class UserAdminService extends Context.Service<
  UserAdminService,
  {
    readonly listUsers: (
      actor: Actor,
      limit: number,
      offset: number,
    ) => Effect.Effect<
      ReadonlyArray<AdminUserSummary>,
      AdminFailure,
      Database | RoleRepository | Authorization
    >;
    readonly banUser: (
      actor: Actor,
      userId: UserId,
      reason: string,
    ) => Effect.Effect<void, AdminFailure, Database | RoleRepository | Authorization>;
    readonly unbanUser: (
      actor: Actor,
      userId: UserId,
    ) => Effect.Effect<void, AdminFailure, Database | RoleRepository | Authorization>;
    readonly revokeUserSessions: (
      actor: Actor,
      userId: UserId,
    ) => Effect.Effect<void, AdminFailure, Database | RoleRepository | Authorization>;
  }
>()("feastjourney/user/UserAdminService") {}

export const UserAdminServiceLive = Layer.succeed(UserAdminService, {
  listUsers: (actor, limit, offset) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "user", actions: ["list"] });

      const rows = yield* repository.usersList(limit, offset);

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        banned: row.banned ?? false,
        createdAt: row.createdAt,
        roles: row.role_ids.filter((id): id is string => id !== null),
      }));
    }),

  banUser: (actor, userId, reason) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "user", actions: ["ban"] });
      yield* repository.banUser(userId, reason);
      yield* repository.deleteSessionsOfUser(userId);
    }),

  unbanUser: (actor, userId) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "user", actions: ["ban"] });
      yield* repository.unbanUser(userId);
    }),

  revokeUserSessions: (actor, userId) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "session", actions: ["revoke-any"] });
      yield* repository.deleteSessionsOfUser(userId);
    }),
});
