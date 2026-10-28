import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SessionLookupError } from "@/modules/user/server/operations/session-service";
import {
  adminRoleAssignSchema,
  adminUserQuerySchema,
  favoriteLinkSchema,
  favoritesQuerySchema,
  profileUpdateSchema,
  roleGrantsSchema,
  roleIdSchema,
  roleMutationSchema,
  sessionRevokeSchema,
  unlinkAccountSchema,
} from "@/modules/user/user.schema";
import { AuthProviderError, InsufficientPermissions } from "@/server/auth/errors";

/**
 * Server-only dependency loader. Dynamic imports keep browser bundles free
 * of server modules (Better Auth, database clients); static imports would
 * execute at route-evaluation time. Each handler destructures only the
 * namespaces it uses, so adding an operation in one domain never touches
 * the imports of another.
 */
const loadServer = async () => {
  const [
    effects,
    server,
    services,
    sessions,
    admin,
    audit,
    authorization,
    errors,
    permissions,
    session,
    betterAuth,
    actor,
    currentActor,
    runtime,
    roleService,
    identifiers,
  ] = await Promise.all([
    import("effect"),
    import("@tanstack/react-start/server"),
    import("@/modules/user/server/operations/user-services"),
    import("@/modules/user/server/operations/session-service"),
    import("@/modules/user/server/operations/admin-service"),
    import("@/modules/user/server/operations/audit"),
    import("@/modules/user/server/operations/authorization"),
    import("@/modules/user/server/domain/errors"),
    import("@/server/auth/permissions"),
    import("@/server/auth/session"),
    import("@/server/auth/better-auth"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
    import("@/modules/user/server/operations/role-service"),
    import("@/modules/user/server/domain/identifiers"),
  ]);

  return {
    effects,
    server,
    services,
    sessions,
    admin,
    audit,
    authorization,
    errors,
    permissions,
    session,
    betterAuth,
    actor,
    currentActor,
    runtime,
    roleService,
    identifiers,
  };
};

export const getProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const { effects, server, services, session, actor, currentActor, runtime } = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime.runApp(
    session.requireAuthenticatedActor(headers),
    "fn/user/profile",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(services.ProfileService, (service) =>
        service.getProfile(trusted.userId),
      ),
    ),
    "fn/user/profile",
    15000,
    requestId,
  );
});

export const updateProfileFn = createServerFn({ method: "POST" })
  .validator(profileUpdateSchema)
  .handler(async ({ data }) => {
    const { effects, server, services, audit, session, actor, currentActor, runtime } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/profile-update",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(services.ProfileService, (service) =>
          service.updateProfile({
            userId: trusted.userId,
            displayName: data.display_name,
            locale: data.locale,
          }),
        ).pipe(
          effects.Effect.tap(() =>
            audit.recordAuditEvent({
              actorUserId: trusted.userId,
              sessionId: trusted.sessionId,
              requestId,
              event: "betterAuth.auth.profile.updated",
              outcome: "succeeded",
              resource: `user:${trusted.userId}`,
            }),
          ),
        ),
      ),
      "fn/user/profile-update",
      15000,
      requestId,
    );
  });

export const listFavoritesFn = createServerFn({ method: "GET" })
  .validator(favoritesQuerySchema)
  .handler(async ({ data }) => {
    const { effects, server, services, session, actor, currentActor, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["read"] }),
      "fn/user/favorites",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(services.FavoritesService, (service) =>
          service.listFavorites(trusted.userId, data.limit),
        ).pipe(
          effects.Effect.map((rows) =>
            rows.map((row) => ({ dish_id: row.dish_id.toString(), created_at: row.created_at })),
          ),
        ),
      ),
      "fn/user/favorites",
      15000,
      requestId,
    );
  });

export const addFavoriteFn = createServerFn({ method: "POST" })
  .validator(favoriteLinkSchema)
  .handler(async ({ data }) => {
    const { effects, server, services, audit, session, actor, currentActor, runtime } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["create"] }),
      "fn/user/favorites-add",
      15000,
      requestId,
    );

    return runtime.runApp(
      currentActor.withActor(
        actor.Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(services.FavoritesService, (service) =>
          service.addFavorite(trusted.userId, data.dish_id),
        ).pipe(
          effects.Effect.map((row) => ({
            dish_id: row.dish_id.toString(),
            created_at: row.created_at,
          })),
          effects.Effect.tap(() =>
            audit.recordAuditEvent({
              actorUserId: trusted.userId,
              sessionId: trusted.sessionId,
              requestId,
              event: "betterAuth.auth.favorite.created",
              outcome: "succeeded",
              resource: `dish:${data.dish_id}`,
            }),
          ),
        ),
      ),
      "fn/user/favorites-add",
      15000,
      requestId,
    );
  });

export const removeFavoriteFn = createServerFn({ method: "POST" })
  .validator(favoriteLinkSchema)
  .handler(async ({ data }) => {
    const { effects, server, services, audit, session, actor, currentActor, runtime } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["delete"] }),
      "fn/user/favorites-remove",
      15000,
      requestId,
    );

    return runtime
      .runApp(
        currentActor.withActor(
          actor.Actor.Member({ userId: trusted.userId }),
          effects.Effect.flatMap(services.FavoritesService, (service) =>
            service.removeFavorite(trusted.userId, data.dish_id),
          ).pipe(
            effects.Effect.tap(() =>
              audit.recordAuditEvent({
                actorUserId: trusted.userId,
                sessionId: trusted.sessionId,
                requestId,
                event: "betterAuth.auth.favorite.deleted",
                outcome: "succeeded",
                resource: `dish:${data.dish_id}`,
              }),
            ),
          ),
        ),
        "fn/user/favorites-remove",
        15000,
        requestId,
      )
      .then(() => ({ ok: true as const }));
  });

export const listSessionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { effects, server, sessions, session, runtime } = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  await runtime.runApp(
    session.requirePermission(headers, { resource: "session", actions: ["list-own"] }),
    "fn/user/sessions",
    15000,
    requestId,
  );

  return runtime.runApp(
    effects.Effect.flatMap(sessions.SessionService, (service) => service.listSessions(headers)),
    "fn/user/sessions",
    15000,
    requestId,
  );
});

export const revokeSessionFn = createServerFn({ method: "POST" })
  .validator(sessionRevokeSchema)
  .handler(async ({ data }) => {
    const { effects, server, sessions, audit, session, actor, currentActor, runtime, identifiers } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
      "fn/user/sessions-revoke",
      15000,
      requestId,
    );

    return runtime
      .runApp(
        currentActor.withActor(
          actor.Actor.Member({ userId: trusted.userId }),
          effects.Effect.flatMap(sessions.SessionService, (service) =>
            service.revokeSession(headers, identifiers.SessionId.parse(data.session_id)),
          ).pipe(
            effects.Effect.tap(() =>
              audit.recordAuditEvent({
                actorUserId: trusted.userId,
                sessionId: trusted.sessionId,
                requestId,
                event: "betterAuth.auth.session.revoked",
                outcome: "succeeded",
              }),
            ),
          ),
        ),
        "fn/user/sessions-revoke",
        15000,
        requestId,
      )
      .then(() => ({ ok: true as const }));
  });

export const revokeOtherSessionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { effects, server, sessions, audit, session, actor, currentActor, runtime } =
    await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime.runApp(
    session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
    "fn/user/sessions-revoke-others",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(sessions.SessionService, (service) =>
        service.revokeOtherSessions(headers),
      ).pipe(
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "betterAuth.auth.session.revoked_others",
            outcome: "succeeded",
          }),
        ),
      ),
    ),
    "fn/user/sessions-revoke-others",
    15000,
    requestId,
  );
});

export const revokeAllSessionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { effects, server, sessions, audit, session, actor, currentActor, runtime } =
    await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runtime.runApp(
    session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
    "fn/user/sessions-revoke-all",
    15000,
    requestId,
  );

  return runtime.runApp(
    currentActor.withActor(
      actor.Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(sessions.SessionService, (service) =>
        service.revokeAllSessions(headers),
      ).pipe(
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "betterAuth.auth.session.revoked_all",
            outcome: "succeeded",
          }),
        ),
      ),
    ),
    "fn/user/sessions-revoke-all",
    15000,
    requestId,
  );
});

const accountListSchema = z.array(z.object({ accountId: z.string(), providerId: z.string() }));

export const listAccountsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    accounts: ReadonlyArray<{ accountId: string; providerId: string }>;
    userId: string;
  }> => {
    const { effects, server, session, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/accounts",
      15000,
      requestId,
    );

    return runtime
      .runApp(
        effects.Effect.flatMap(
          // SAFETY: Better Auth's endpoint types are any-laden; narrow to unknown
          // and validate the shape with Zod below instead of trusting the client.
          effects.Effect.tryPromise({
            try: () => betterAuth.auth.api.listUserAccounts({ headers }) as Promise<unknown>,
            catch: (cause) =>
              new AuthProviderError({ operation: "auth/accounts", reason: String(cause) }),
          }),
          (accounts) => {
            const parsed = accountListSchema.safeParse(accounts);

            if (!parsed.success) {
              return effects.Effect.fail(
                new SessionLookupError({ reason: "account list shape changed" }),
              );
            }

            return effects.Effect.succeed(parsed.data);
          },
        ),
        "fn/user/accounts",
        15000,
        requestId,
      )
      .then((accounts) => ({ accounts, userId: trusted.userId }));
  },
);

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const { server, session, runtime } = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return runtime.runApp(session.resolveSession(headers), "fn/user/session", 15000, requestId).then(
    (trusted) => ({
      user: { id: trusted.userId, name: trusted.name, email: trusted.email },
    }),
    () => ({ user: null }),
  );
});

const authCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const signUpSchema = authCredentialsSchema.extend({
  name: z.string().min(1).max(100),
});

export const signUpFn = createServerFn({ method: "POST" })
  .validator(signUpSchema)
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () => betterAuth.auth.api.signUpEmail({ body: data, headers }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/sign-up", reason: String(cause) }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/sign-up",
      15000,
      requestId,
    );
  });

export const signInFn = createServerFn({ method: "POST" })
  .validator(authCredentialsSchema)
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () =>
          betterAuth.auth.api.signInEmail({
            body: { email: data.email, password: data.password },
            headers,
          }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/sign-in", reason: String(cause) }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/sign-in",
      15000,
      requestId,
    );
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { effects, server, betterAuth, runtime } = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return runtime.runApp(
    effects.Effect.tryPromise({
      try: () => betterAuth.auth.api.signOut({ headers }),
      catch: (cause) =>
        new AuthProviderError({ operation: "auth/sign-out", reason: String(cause) }),
    }).pipe(effects.Effect.as({ ok: true as const })),
    "fn/auth/sign-out",
    15000,
    requestId,
  );
});

export const socialSignInFn = createServerFn({ method: "POST" })
  .validator(z.object({ provider: z.enum(["google", "facebook"]), callbackURL: z.string() }))
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () => betterAuth.auth.api.signInSocial({ body: data, headers }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/sign-in-social", reason: String(cause) }),
      }).pipe(effects.Effect.map((result) => ({ url: result.url ?? "/" }))),
      "fn/auth/social",
      15000,
      requestId,
    );
  });

export const forgetPasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email(), redirectTo: z.string() }))
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () => betterAuth.auth.api.requestPasswordReset({ body: data, headers }),
        catch: (cause) =>
          new AuthProviderError({
            operation: "auth/request-password-reset",
            reason: String(cause),
          }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/forget-password",
      15000,
      requestId,
    );
  });

export const resetPasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ newPassword: z.string().min(8), token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () => betterAuth.auth.api.resetPassword({ body: data, headers }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/reset-password", reason: String(cause) }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/reset-password",
      15000,
      requestId,
    );
  });

export const resendVerificationFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email(), callbackURL: z.string() }))
  .handler(async ({ data }) => {
    const { effects, server, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () => betterAuth.auth.api.sendVerificationEmail({ body: data, headers }),
        catch: (cause) =>
          new AuthProviderError({
            operation: "auth/send-verification-email",
            reason: String(cause),
          }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/resend-verification",
      15000,
      requestId,
    );
  });

export const changePasswordFn = createServerFn({ method: "POST" })
  .validator(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }))
  .handler(async ({ data }) => {
    const { effects, server, audit, session, betterAuth, runtime } = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requireAuthenticatedActor(headers),
      "fn/auth/change-password",
      15000,
      requestId,
    );

    return runtime.runApp(
      effects.Effect.tryPromise({
        try: () =>
          betterAuth.auth.api.changePassword({
            body: { ...data, revokeOtherSessions: true },
            headers,
          }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/change-password", reason: String(cause) }),
      }).pipe(
        effects.Effect.as({ ok: true as const }),
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "betterAuth.auth.password.changed",
            outcome: "succeeded",
          }),
        ),
      ),
      "fn/auth/change-password",
      15000,
      requestId,
    );
  });

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

export const unlinkAccountFn = createServerFn({ method: "POST" })
  .validator(unlinkAccountSchema)
  .handler(async ({ data }) => {
    const { effects, server, sessions, audit, session, actor, currentActor, runtime } =
      await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runtime.runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/unlink",
      15000,
      requestId,
    );

    return runtime
      .runApp(
        currentActor.withActor(
          actor.Actor.Member({ userId: trusted.userId }),
          effects.Effect.flatMap(sessions.SessionService, (service) =>
            service.unlinkAccount(headers, data.account_id),
          ).pipe(
            effects.Effect.tap(() =>
              audit.recordAuditEvent({
                actorUserId: trusted.userId,
                sessionId: trusted.sessionId,
                requestId,
                event: "betterAuth.auth.account.unlinked",
                outcome: "succeeded",
                resource: `account:${data.account_id}`,
              }),
            ),
          ),
        ),
        "fn/user/unlink",
        15000,
        requestId,
      )
      .then(() => ({ ok: true as const }));
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
