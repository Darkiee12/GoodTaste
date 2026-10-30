import { Context, Effect, Layer } from "effect";

import activeOwnerCount from "@/modules/user/server/repository/sql/active-owner-count.sql";
import ownerCount from "@/modules/user/server/repository/sql/owner-count.sql";
import ownerGuardLock from "@/modules/user/server/repository/sql/owner-guard-lock.sql";
import roleById from "@/modules/user/server/repository/sql/role-by-id.sql";
import roleDelete from "@/modules/user/server/repository/sql/role-delete.sql";
import roleInsert from "@/modules/user/server/repository/sql/role-insert.sql";
import roleMemberCounts from "@/modules/user/server/repository/sql/role-member-counts.sql";
import rolePermissionGrant from "@/modules/user/server/repository/sql/role-permission-grant.sql";
import rolePermissionRevoke from "@/modules/user/server/repository/sql/role-permission-revoke.sql";
import rolePermissionsByRole from "@/modules/user/server/repository/sql/role-permissions-by-role.sql";
import rolePermissionsByUser from "@/modules/user/server/repository/sql/role-permissions-by-user.sql";
import roleUpdate from "@/modules/user/server/repository/sql/role-update.sql";
import rolesList from "@/modules/user/server/repository/sql/roles-list.sql";
import sessionsDeleteByUser from "@/modules/user/server/repository/sql/sessions-delete-by-user.sql";
import userBan from "@/modules/user/server/repository/sql/user-ban.sql";
import userBannedById from "@/modules/user/server/repository/sql/user-banned-by-id.sql";
import userFindByEmail from "@/modules/user/server/repository/sql/user-find-by-email.sql";
import userRoleAssign from "@/modules/user/server/repository/sql/user-role-assign.sql";
import userRoleRemove from "@/modules/user/server/repository/sql/user-role-remove.sql";
import userRolesByUser from "@/modules/user/server/repository/sql/user-roles-by-user.sql";
import userUnban from "@/modules/user/server/repository/sql/user-unban.sql";
import usersList from "@/modules/user/server/repository/sql/users-list.sql";
import type { Database } from "@/server/database/client";
import { runQuery } from "@/server/database/query";
import type { DatabaseError } from "@/server/database/query";

export type RoleRow = (typeof roleById)["~reylo"]["element"];

export type RoleMemberCountRow = (typeof roleMemberCounts)["~reylo"]["element"];

export type RolePermissionRow = (typeof rolePermissionsByRole)["~reylo"]["element"];

export type UserRoleRow = (typeof userRolesByUser)["~reylo"]["element"];

export type MemberRow = (typeof usersList)["~reylo"]["element"];

export type MemberLookupRow = (typeof userFindByEmail)["~reylo"]["element"];

export class RoleRepository extends Context.Service<
  RoleRepository,
  {
    readonly permissionsOfUser: (
      userId: string,
    ) => Effect.Effect<ReadonlyArray<{ permission_key: string }>, DatabaseError, Database>;
    readonly rolesOfUser: (
      userId: string,
    ) => Effect.Effect<ReadonlyArray<UserRoleRow>, DatabaseError, Database>;
    readonly roleById: (roleId: string) => Effect.Effect<RoleRow | null, DatabaseError, Database>;
    readonly rolesList: () => Effect.Effect<ReadonlyArray<RoleRow>, DatabaseError, Database>;
    readonly memberCounts: () => Effect.Effect<
      ReadonlyArray<RoleMemberCountRow>,
      DatabaseError,
      Database
    >;
    readonly insertRole: (input: {
      readonly id: string;
      readonly slug: string;
      readonly name: string;
      readonly description: string;
      readonly color: string;
      readonly position: number;
    }) => Effect.Effect<RoleRow, DatabaseError, Database>;
    readonly updateRole: (input: {
      readonly id: string;
      readonly slug: string;
      readonly name: string;
      readonly description: string;
      readonly color: string;
      readonly position: number;
    }) => Effect.Effect<RoleRow | null, DatabaseError, Database>;
    readonly deleteRole: (roleId: string) => Effect.Effect<void, DatabaseError, Database>;
    readonly permissionsOfRole: (
      roleId: string,
    ) => Effect.Effect<ReadonlyArray<RolePermissionRow>, DatabaseError, Database>;
    readonly grantPermission: (
      roleId: string,
      permission: string,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly revokePermission: (
      roleId: string,
      permission: string,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly assignRole: (
      userId: string,
      roleId: string,
      assignedBy: string | null,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly removeRole: (
      userId: string,
      roleId: string,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly ownerCount: () => Effect.Effect<bigint, DatabaseError, Database>;
    readonly activeOwnerCount: () => Effect.Effect<bigint, DatabaseError, Database>;
    /**
     * Row-level lock serializing owner-membership changes. Every operation
     * that can remove the last active Owner takes this lock before counting,
     * so two concurrent removals cannot both observe two owners and commit.
     * Unrelated role changes never take it.
     */
    readonly lockOwnerGuard: () => Effect.Effect<void, DatabaseError, Database>;
    readonly isUserBanned: (userId: string) => Effect.Effect<boolean, DatabaseError, Database>;
    readonly usersList: (
      limit: number,
      offset: number,
    ) => Effect.Effect<ReadonlyArray<MemberRow>, DatabaseError, Database>;
    readonly findUserByEmail: (
      email: string,
    ) => Effect.Effect<MemberLookupRow | null, DatabaseError, Database>;
    readonly banUser: (
      userId: string,
      reason: string | null,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly unbanUser: (userId: string) => Effect.Effect<void, DatabaseError, Database>;
    readonly deleteSessionsOfUser: (userId: string) => Effect.Effect<void, DatabaseError, Database>;
  }
>()("feastjourney/user/RoleRepository") {}

export const RoleRepositoryLive = Layer.succeed(RoleRepository, {
  permissionsOfUser: (userId) =>
    runQuery("user/role-permissions-by-user", (sql) =>
      rolePermissionsByUser.run(sql, { user_id: userId }),
    ),
  rolesOfUser: (userId) =>
    runQuery("user/user-roles-by-user", (sql) => userRolesByUser.run(sql, { user_id: userId })),
  roleById: (roleId) => runQuery("user/role-by-id", (sql) => roleById.run(sql, { id: roleId })),
  rolesList: () => runQuery("user/roles-list", (sql) => rolesList.run(sql)),
  memberCounts: () => runQuery("user/role-member-counts", (sql) => roleMemberCounts.run(sql)),
  insertRole: (input) =>
    runQuery("user/role-insert", (sql) =>
      roleInsert.run(sql, {
        id: input.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        color: input.color,
        position: input.position,
      }),
    ),
  updateRole: (input) =>
    runQuery("user/role-update", (sql) =>
      roleUpdate.run(sql, {
        id: input.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        color: input.color,
        position: input.position,
      }),
    ),
  deleteRole: (roleId) =>
    runQuery("user/role-delete", (sql) => roleDelete.run(sql, { id: roleId })),
  permissionsOfRole: (roleId) =>
    runQuery("user/role-permissions-by-role", (sql) =>
      rolePermissionsByRole.run(sql, { role_id: roleId }),
    ),
  grantPermission: (roleId, permission) =>
    runQuery("user/role-permission-grant", (sql) =>
      rolePermissionGrant.run(sql, { role_id: roleId, permission_key: permission }),
    ),
  revokePermission: (roleId, permission) =>
    runQuery("user/role-permission-revoke", (sql) =>
      rolePermissionRevoke.run(sql, { role_id: roleId, permission_key: permission }),
    ),
  assignRole: (userId, roleId, assignedBy) =>
    runQuery("user/user-role-assign", (sql) =>
      userRoleAssign.run(sql, { user_id: userId, role_id: roleId, assigned_by: assignedBy }),
    ),
  removeRole: (userId, roleId) =>
    runQuery("user/user-role-remove", (sql) =>
      userRoleRemove.run(sql, { user_id: userId, role_id: roleId }),
    ),
  ownerCount: () =>
    runQuery("user/owner-count", async (sql) => {
      const row = await ownerCount.run(sql);

      return row.owner_count;
    }),
  activeOwnerCount: () =>
    runQuery("user/active-owner-count", async (sql) => {
      const row = await activeOwnerCount.run(sql);

      return row.owner_count;
    }),
  lockOwnerGuard: () =>
    runQuery("user/owner-guard-lock", (sql) => ownerGuardLock.run(sql)).pipe(Effect.asVoid),
  isUserBanned: (userId) =>
    runQuery("user/user-banned-by-id", async (sql) => {
      const row = await userBannedById.run(sql, { user_id: userId });

      return row?.banned ?? false;
    }),
  usersList: (limit, offset) =>
    runQuery("user/users-list", (sql) => usersList.run(sql, { limit, offset })),
  findUserByEmail: (email) =>
    Effect.gen(function* () {
      return yield* runQuery("user/find-by-email", (sql) => userFindByEmail.run(sql, { email }));
    }),
  banUser: (userId, reason) =>
    runQuery("user/user-ban", (sql) => userBan.run(sql, { user_id: userId, reason })),
  unbanUser: (userId) =>
    runQuery("user/user-unban", (sql) => userUnban.run(sql, { user_id: userId })),
  deleteSessionsOfUser: (userId) =>
    runQuery("user/sessions-delete-by-user", (sql) =>
      sessionsDeleteByUser.run(sql, { user_id: userId }),
    ),
});
