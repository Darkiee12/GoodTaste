import { Context, Effect, Layer } from "effect";

import type { UserId } from "@/modules/user/server/domain/identifiers";
import { recordAuditEvent, type AuditContext } from "@/modules/user/server/operations/audit";
import { Authorization } from "@/modules/user/server/operations/authorization";
import { RoleRepository } from "@/modules/user/server/repository/role-repository";
import type { UserRepository } from "@/modules/user/server/repository/user-repository";
import { Actor } from "@/server/auth/actor";
import { type InsufficientPermissions, LastOwnerRemovalDenied } from "@/server/auth/errors";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import type { TransactionFailed } from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";

export interface AdminUserSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly banned: boolean;
  readonly createdAt: string;
  readonly roles: ReadonlyArray<string>;
}

type AdminFailure =
  | InsufficientPermissions
  | LastOwnerRemovalDenied
  | TransactionFailed
  | DatabaseError;

const actorUserId = (actor: Actor): string | null =>
  Actor.$match(actor, {
    Guest: () => null,
    Member: ({ userId }) => userId,
  });

/**
 * User account administration behind dynamic RBAC. All reads and writes go
 * through application-owned Reylo queries; Better Auth's plugin admin
 * endpoints are locked down to empty grants and never called, so no static
 * role check can bypass these guards.
 *
 * Every mutation and its mandatory audit record commit in one transaction.
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
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      AdminFailure,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly unbanUser: (
      actor: Actor,
      userId: UserId,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      AdminFailure,
      Database | RoleRepository | UserRepository | Authorization
    >;
    readonly revokeUserSessions: (
      actor: Actor,
      userId: UserId,
      audit: AuditContext,
    ) => Effect.Effect<
      void,
      AdminFailure,
      Database | RoleRepository | UserRepository | Authorization
    >;
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

  banUser: (actor, userId, reason, audit) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "user", actions: ["ban"] });

      return yield* withTransaction(
        "user/ban",
        Effect.gen(function* () {
          // Target protection: ordinary administrators can never disable a
          // protected account. Owners are manageable only with
          // `role:manage-protected`, and even then the last active Owner
          // cannot be banned: the count and the mutation share one
          // transaction under the owner guard lock.
          const assignments = yield* repository.rolesOfUser(userId);

          if (assignments.some((entry) => entry.role_id === SYSTEM_ROLES.owner)) {
            yield* authorization.require(actor, {
              resource: "role",
              actions: ["manage-protected"],
            });

            const alreadyBanned = yield* repository.isUserBanned(userId);

            if (!alreadyBanned) {
              yield* repository.lockOwnerGuard();

              const remaining = yield* repository.activeOwnerCount();

              if (remaining <= BigInt(1)) {
                return yield* new LastOwnerRemovalDenied({
                  reason: "cannot ban the last active owner",
                });
              }
            }
          }

          yield* repository.banUser(userId, reason);
          yield* repository.deleteSessionsOfUser(userId);

          return yield* recordAuditEvent({
            actorUserId: actorUserId(actor),
            sessionId: audit.sessionId,
            requestId: audit.requestId,
            event: "auth.user.banned",
            outcome: "succeeded",
            resource: `user:${userId}`,
            metadata: { reason },
          });
        }),
      );
    }),

  unbanUser: (actor, userId, audit) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "user", actions: ["ban"] });

      return yield* withTransaction(
        "user/unban",
        Effect.gen(function* () {
          yield* repository.unbanUser(userId);

          return yield* recordAuditEvent({
            actorUserId: actorUserId(actor),
            sessionId: audit.sessionId,
            requestId: audit.requestId,
            event: "auth.user.unbanned",
            outcome: "succeeded",
            resource: `user:${userId}`,
          });
        }),
      );
    }),

  revokeUserSessions: (actor, userId, audit) =>
    Effect.gen(function* () {
      const authorization = yield* Authorization;
      const repository = yield* RoleRepository;

      yield* authorization.require(actor, { resource: "session", actions: ["revoke-any"] });

      return yield* withTransaction(
        "user/sessions-revoke",
        Effect.gen(function* () {
          // Target protection: revoking a protected account's sessions also
          // needs `role:manage-protected`. No liveness lock: sessions can be
          // re-established, so this is an authority check, not an invariant.
          const assignments = yield* repository.rolesOfUser(userId);

          if (assignments.some((entry) => entry.role_id === SYSTEM_ROLES.owner)) {
            yield* authorization.require(actor, {
              resource: "role",
              actions: ["manage-protected"],
            });
          }

          yield* repository.deleteSessionsOfUser(userId);

          return yield* recordAuditEvent({
            actorUserId: actorUserId(actor),
            sessionId: audit.sessionId,
            requestId: audit.requestId,
            event: "auth.user.sessions_revoked",
            outcome: "succeeded",
            resource: `user:${userId}`,
          });
        }),
      );
    }),
});
