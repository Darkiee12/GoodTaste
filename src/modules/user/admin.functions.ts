import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  adminRoleAssignSchema,
  adminUserEmailSchema,
  adminUserQuerySchema,
  roleGrantsSchema,
  roleIdSchema,
  roleMutationSchema,
} from "@/modules/user/user.schema";
import { InsufficientPermissions } from "@/server/auth/errors";

/**
 * Administration server functions: users, roles, grants, and bans.
 *
 * Server-only dependencies stay behind the dynamic loader below so
 * browser bundles never execute server modules; each handler
 * destructures only the namespaces it uses.
 */
const loadServer = async () => {
  const [
    effects,
    server,
    admin,
    authorization,
    session,
    actor,
    currentActor,
    runtime,
    roleService,
    identifiers,
    permissions,
  ] = await Promise.all([
    import("effect"),
    import("@tanstack/react-start/server"),
    import("@/modules/user/server/operations/admin-service"),
    import("@/modules/user/server/operations/authorization"),
    import("@/server/auth/session"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
    import("@/modules/user/server/operations/role-service"),
    import("@/modules/user/server/domain/identifiers"),
    import("@/server/auth/permissions"),
  ]);

  return {
    effects,
    server,
    admin,
    authorization,
    session,
    actor,
    currentActor,
    runtime,
    roleService,
    identifiers,
    permissions,
  };
};

export const authorizeFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      checks: z
        .array(
          z.object({ resource: z.string().min(1), actions: z.array(z.string().min(1)).min(1) }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { effects, server, authorization, session, actor, runtime, permissions } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime
      .runApp(
        effects.Effect.flatMap(session.requireAuthenticatedActor(headers), (trusted) =>
          effects.Effect.forEach(data.checks, (check) => {
            // Unknown resource:action pairs can never be granted; fail the
            // check here so unvalidated HTTP input cannot become a typed
            // PermissionRequest downstream.
            if (!permissions.isPermissionRequest(check)) {
              return effects.Effect.fail(
                new InsufficientPermissions({
                  reason: `Unknown permission request: ${check.resource}.`,
                }),
              );
            }

            return effects.Effect.flatMap(authorization.Authorization, (authz) =>
              authz.require(actor.Actor.Member({ userId: trusted.userId }), check),
            );
          }),
        ),
        "fn/user/authorize",
        15000,
        requestId,
      )
      .then(
        () => ({ allowed: true as const }),
        () => ({ allowed: false as const }),
      );
  });

/**
 * Server-authoritative admin navigation capabilities, computed once per page
 * load. Each section maps to the same resource:action vocabulary its
 * operations enforce — never a separate hardcoded role flag. Route-level
 * guards still enforce their own (possibly stricter) checks; this only
 * decides which nav entries to render.
 */
export type AdminCapabilities = {
  readonly admin: boolean;
  readonly overview: boolean;
  readonly dishes: boolean;
  readonly imports: boolean;
  readonly reviews: boolean;
  readonly members: boolean;
  readonly roles: boolean;
};

export const NO_ADMIN_CAPABILITIES: AdminCapabilities = {
  admin: false,
  dishes: false,
  imports: false,
  members: false,
  overview: false,
  reviews: false,
  roles: false,
};

export const adminCapabilitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { effects, server, authorization, session, actor, runtime, permissions } =
    await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime
    .runApp(session.requireAuthenticatedActor(headers), "fn/admin/capabilities", 15000, requestId)
    .then(
      (verified) => verified,
      () => null,
    );

  if (trusted === null) {
    return { capabilities: NO_ADMIN_CAPABILITIES };
  }

  return runtime.runApp(
    effects.Effect.gen(function* () {
      const member = actor.Actor.Member({ userId: trusted.userId });

      const sectionAllowed = (resource: string, actions: ReadonlyArray<string>) => {
        const check = { resource, actions };

        if (!permissions.isPermissionRequest(check)) {
          return effects.Effect.succeed(false);
        }

        return effects.Effect.flatMap(authorization.Authorization, (authz) =>
          authz.has(member, check),
        );
      };

      // Members operations require both user:list and admin:access; mirror
      // that here so the nav entry never advertises what the operation
      // will deny.
      const membersAllowed = effects.Effect.all(
        [sectionAllowed("user", ["list"]), sectionAllowed("admin", ["access"])],
        { concurrency: 2 },
      ).pipe(effects.Effect.map(([listed, surfaced]) => listed && surfaced));

      const [admin, overview, dishes, imports, reviews, members, roles] = yield* effects.Effect.all(
        [
          sectionAllowed("admin", ["access"]),
          sectionAllowed("food", ["read"]),
          sectionAllowed("food", ["read"]),
          sectionAllowed("food", ["import"]),
          sectionAllowed("moderation", ["read"]),
          membersAllowed,
          sectionAllowed("role", ["read"]),
        ],
        { concurrency: "unbounded" },
      );

      return {
        capabilities: { admin, dishes, imports, members, overview, reviews, roles },
      };
    }),
    "fn/admin/capabilities",
    15000,
    requestId,
  );
});

export const adminListUsersFn = createServerFn({ method: "GET" })
  .validator(adminUserQuerySchema)
  .handler(async ({ data }) => {
    const { effects, server, admin, session, actor, currentActor, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, [
        { resource: "user", actions: ["list"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/users",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(admin.UserAdminService, (service) =>
          service.listUsers(
            actor.Actor.Member({ userId: trusted.userId }),
            data.limit,
            data.offset,
          ),
        ),
      ),
      "fn/admin/users",
      15000,
      requestId,
    );
  });

export const adminFindUserByEmailFn = createServerFn({ method: "GET" })
  .validator(adminUserEmailSchema)
  .handler(async ({ data }) => {
    const { effects, server, admin, session, actor, currentActor, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, [
        { resource: "user", actions: ["list"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/user-by-email",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(admin.UserAdminService, (service) =>
          service.findUserByEmail(actor.Actor.Member({ userId: trusted.userId }), data.email),
        ),
      ),
      "fn/admin/user-by-email",
      15000,
      requestId,
    );
  });

export const adminAssignRoleFn = createServerFn({ method: "POST" })
  .validator(adminRoleAssignSchema)
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["manage-roles"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/assign-role",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.assignRole(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.UserId.parse(data.user_id),
            identifiers.RoleId.parse(data.role_id),
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/assign-role",
      15000,
      requestId,
    );
  });

export const adminRemoveRoleFn = createServerFn({ method: "POST" })
  .validator(adminRoleAssignSchema)
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["manage-roles"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/remove-role",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.removeRole(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.UserId.parse(data.user_id),
            identifiers.RoleId.parse(data.role_id),
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/remove-role",
      15000,
      requestId,
    );
  });

export const adminListRolesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { effects, server, session, actor, currentActor, runtime, roleService } =
    await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime.runApp(
    session.requirePermission(headers, [{ resource: "role", actions: ["read"] }]),
    "fn/admin/roles",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(roleService.RoleService, (service) =>
        service.listRoles(actor.Actor.Member({ userId: trusted.userId })),
      ),
    ),
    "fn/admin/roles",
    15000,
    requestId,
  );
});

export const adminRoleMemberCountsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { effects, server, session, actor, currentActor, runtime, roleService } =
    await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime.runApp(
    session.requirePermission(headers, [{ resource: "role", actions: ["read"] }]),
    "fn/admin/role-member-counts",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(roleService.RoleService, (service) =>
        service.memberCounts(actor.Actor.Member({ userId: trusted.userId })),
      ),
    ),
    "fn/admin/role-member-counts",
    15000,
    requestId,
  );
});

export const adminSetRoleGrantsFn = createServerFn({ method: "POST" })
  .validator(roleGrantsSchema)
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "role", actions: ["manage-permissions"] },
        ]);

        return verified;
      }),
      "fn/admin/set-role-grants",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.setRoleGrants(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.RoleId.parse(data.role_id),
            data.permissions,
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/set-role-grants",
      15000,
      requestId,
    );
  });

export const adminBanUserFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ user_id: z.string().min(1).max(255), reason: z.string().max(500).default("") }),
  )
  .handler(async ({ data }) => {
    const { effects, server, admin, session, actor, currentActor, runtime, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["ban"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/ban-user",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(admin.UserAdminService, (service) =>
          service.banUser(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.UserId.parse(data.user_id),
            data.reason,
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/ban-user",
      15000,
      requestId,
    );
  });

export const adminUnbanUserFn = createServerFn({ method: "POST" })
  .validator(z.object({ user_id: z.string().min(1).max(255) }))
  .handler(async ({ data }) => {
    const { effects, server, admin, session, actor, currentActor, runtime, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, [
        { resource: "user", actions: ["ban"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/unban-user",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(admin.UserAdminService, (service) =>
          service.unbanUser(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.UserId.parse(data.user_id),
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/unban-user",
      15000,
      requestId,
    );
  });

export const adminCreateRoleFn = createServerFn({ method: "POST" })
  .validator(roleMutationSchema)
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "role", actions: ["create"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/create-role",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.createRole(
            actor.Actor.Member({ userId: trusted.userId }),
            {
              slug: data.slug,
              name: data.name,
              description: data.description,
              color: data.color,
              position: data.position,
            },
            { requestId, sessionId: trusted.sessionId },
          ),
        ),
      ),
      "fn/admin/create-role",
      15000,
      requestId,
    );
  });

export const adminUpdateRoleFn = createServerFn({ method: "POST" })
  .validator(roleMutationSchema.extend(roleIdSchema.shape))
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "role", actions: ["update"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/update-role",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.updateRole(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.RoleId.parse(data.role_id),
            {
              slug: data.slug,
              name: data.name,
              description: data.description,
              color: data.color,
              position: data.position,
            },
            { requestId, sessionId: trusted.sessionId },
          ),
        ),
      ),
      "fn/admin/update-role",
      15000,
      requestId,
    );
  });

export const adminDeleteRoleFn = createServerFn({ method: "POST" })
  .validator(roleIdSchema)
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, roleService, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      effects.Effect.gen(function* () {
        const verified = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(verified);
        yield* session.requirePermission(headers, [
          { resource: "role", actions: ["delete"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return verified;
      }),
      "fn/admin/delete-role",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleService.RoleService, (service) =>
          service.deleteRole(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.RoleId.parse(data.role_id),
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/delete-role",
      15000,
      requestId,
    );
  });

export const adminRevokeUserSessionsFn = createServerFn({ method: "POST" })
  .validator(z.object({ user_id: z.string().min(1).max(255) }))
  .handler(async ({ data }) => {
    const { effects, server, session, actor, currentActor, runtime, admin, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, [
        { resource: "session", actions: ["revoke-any"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/revoke-user-sessions",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(admin.UserAdminService, (service) =>
          service.revokeUserSessions(
            actor.Actor.Member({ userId: trusted.userId }),
            identifiers.UserId.parse(data.user_id),
            { requestId, sessionId: trusted.sessionId },
          ),
        ).pipe(effects.Effect.as({ ok: true as const })),
      ),
      "fn/admin/revoke-user-sessions",
      15000,
      requestId,
    );
  });
