import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SessionLookupError } from "@/modules/user/server/operations/session-service";
import {
  adminRoleAssignSchema,
  adminUserQuerySchema,
  favoriteLinkSchema,
  favoritesQuerySchema,
  profileUpdateSchema,
  sessionRevokeSchema,
  unlinkAccountSchema,
} from "@/modules/user/user.schema";
import { AuthProviderError } from "@/server/auth/errors";

const loadServer = () =>
  Promise.all([
    import("effect"),
    import("@tanstack/react-start/server"),
    import("@/modules/user/server/operations/user-services"),
    import("@/modules/user/server/operations/session-service"),
    import("@/modules/user/server/operations/admin-service"),
    import("@/modules/user/server/operations/audit"),
    import("@/modules/user/server/operations/authorization"),
    import("@/modules/user/server/domain/errors"),
    import("@/server/auth/session"),
    import("@/server/auth/better-auth"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
    import("@/modules/user/server/operations/role-service"),
    import("@/modules/user/server/domain/identifiers"),
  ]);

export const getProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const [
    effects,
    server,
    { ProfileService },
    _sessions,
    _admin,
    _audit,
    _authorization,
    _errors,
    session,
    { auth: _auth },
    { Actor },
    { withActor },
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runApp(
    session.requireAuthenticatedActor(headers),
    "fn/user/profile",
    15000,
    requestId,
  );

  return runApp(
    withActor(
      Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(ProfileService, (service) => service.getProfile(trusted.userId)),
    ),
    "fn/user/profile",
    15000,
    requestId,
  );
});

export const updateProfileFn = createServerFn({ method: "POST" })
  .validator(profileUpdateSchema)
  .handler(async ({ data }) => {
    const [
      effects,
      server,
      { ProfileService },
      _sessions,
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/profile-update",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(ProfileService, (service) =>
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
              event: "auth.profile.updated",
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
    const [
      effects,
      server,
      { FavoritesService },
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["read"] }),
      "fn/user/favorites",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(FavoritesService, (service) =>
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
    const [
      effects,
      server,
      { FavoritesService },
      _sessions,
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["create"] }),
      "fn/user/favorites-add",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(FavoritesService, (service) =>
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
              event: "auth.favorite.created",
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
    const [
      effects,
      server,
      { FavoritesService },
      _sessions,
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, { resource: "favorite", actions: ["delete"] }),
      "fn/user/favorites-remove",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(FavoritesService, (service) =>
          service.removeFavorite(trusted.userId, data.dish_id),
        ).pipe(
          effects.Effect.tap(() =>
            audit.recordAuditEvent({
              actorUserId: trusted.userId,
              sessionId: trusted.sessionId,
              requestId,
              event: "auth.favorite.deleted",
              outcome: "succeeded",
              resource: `dish:${data.dish_id}`,
            }),
          ),
        ),
      ),
      "fn/user/favorites-remove",
      15000,
      requestId,
    ).then(() => ({ ok: true as const }));
  });

export const listSessionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const [
    effects,
    server,
    _services,
    { SessionService },
    _admin,
    _audit,
    _authorization,
    _errors,
    session,
    { auth: _auth },
    { Actor: _Actor },
    { withActor: _withActor },
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  await runApp(
    session.requirePermission(headers, { resource: "session", actions: ["list-own"] }),
    "fn/user/sessions",
    15000,
    requestId,
  );

  return runApp(
    effects.Effect.flatMap(SessionService, (service) => service.listSessions(headers)),
    "fn/user/sessions",
    15000,
    requestId,
  );
});

export const revokeSessionFn = createServerFn({ method: "POST" })
  .validator(sessionRevokeSchema)
  .handler(async ({ data }) => {
    const [
      effects,
      server,
      _services,
      { SessionService },
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
      "fn/user/sessions-revoke",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(SessionService, (service) =>
          service.revokeSession(headers, data.session_id),
        ).pipe(
          effects.Effect.tap(() =>
            audit.recordAuditEvent({
              actorUserId: trusted.userId,
              sessionId: trusted.sessionId,
              requestId,
              event: "auth.session.revoked",
              outcome: "succeeded",
            }),
          ),
        ),
      ),
      "fn/user/sessions-revoke",
      15000,
      requestId,
    ).then(() => ({ ok: true as const }));
  });

export const revokeOtherSessionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const [
    effects,
    server,
    _services,
    { SessionService },
    _admin,
    audit,
    _authorization,
    _errors,
    session,
    { auth: _auth },
    { Actor },
    { withActor },
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runApp(
    session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
    "fn/user/sessions-revoke-others",
    15000,
    requestId,
  );

  return runApp(
    withActor(
      Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(SessionService, (service) =>
        service.revokeOtherSessions(headers),
      ).pipe(
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "auth.session.revoked_others",
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
  const [
    effects,
    server,
    _services,
    { SessionService },
    _admin,
    audit,
    _authorization,
    _errors,
    session,
    { auth: _auth },
    { Actor },
    { withActor },
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runApp(
    session.requirePermission(headers, { resource: "session", actions: ["revoke-own"] }),
    "fn/user/sessions-revoke-all",
    15000,
    requestId,
  );

  return runApp(
    withActor(
      Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(SessionService, (service) => service.revokeAllSessions(headers)).pipe(
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "auth.session.revoked_all",
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/accounts",
      15000,
      requestId,
    );

    return runApp(
      effects.Effect.flatMap(
        // SAFETY: Better Auth's endpoint types are any-laden; narrow to unknown
        // and validate the shape with Zod below instead of trusting the client.
        effects.Effect.tryPromise({
          try: () => auth.api.listUserAccounts({ headers }) as Promise<unknown>,
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
    ).then((accounts) => ({ accounts, userId: trusted.userId }));
  },
);

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const [
    _effects,
    server,
    _services,
    _sessions,
    _admin,
    _audit,
    _authorization,
    _errors,
    session,
    { auth: _auth },
    _actor,
    _withActor,
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return runApp(session.resolveSession(headers), "fn/user/session", 15000, requestId).then(
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () => auth.api.signUpEmail({ body: data, headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () =>
          auth.api.signInEmail({ body: { email: data.email, password: data.password }, headers }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/sign-in", reason: String(cause) }),
      }).pipe(effects.Effect.as({ ok: true as const })),
      "fn/auth/sign-in",
      15000,
      requestId,
    );
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const [
    effects,
    server,
    _services,
    _sessions,
    _admin,
    _audit,
    _authorization,
    _errors,
    _session,
    { auth },
    _actor,
    _withActor,
    { runApp },
    _roleService,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  return runApp(
    effects.Effect.tryPromise({
      try: () => auth.api.signOut({ headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () => auth.api.signInSocial({ body: data, headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () => auth.api.requestPasswordReset({ body: data, headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () => auth.api.resetPassword({ body: data, headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorization,
      _errors,
      _session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.tryPromise({
        try: () => auth.api.sendVerificationEmail({ body: data, headers }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth },
      _actor,
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requireAuthenticatedActor(headers),
      "fn/auth/change-password",
      15000,
      requestId,
    );

    return runApp(
      effects.Effect.tryPromise({
        try: () =>
          auth.api.changePassword({ body: { ...data, revokeOtherSessions: true }, headers }),
        catch: (cause) =>
          new AuthProviderError({ operation: "auth/change-password", reason: String(cause) }),
      }).pipe(
        effects.Effect.as({ ok: true as const }),
        effects.Effect.tap(() =>
          audit.recordAuditEvent({
            actorUserId: trusted.userId,
            sessionId: trusted.sessionId,
            requestId,
            event: "auth.password.changed",
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      { Authorization },
      _errors,
      session,
      { auth: _auth3 },
      { Actor },
      _withActor,
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    return runApp(
      effects.Effect.flatMap(session.requireAuthenticatedActor(headers), (trusted) =>
        effects.Effect.forEach(data.checks, (check) =>
          effects.Effect.flatMap(Authorization, (authorization) =>
            authorization.require(Actor.Member({ userId: trusted.userId }), check),
          ),
        ),
      ),
      "fn/user/authorize",
      15000,
      requestId,
    ).then(
      () => ({ allowed: true as const }),
      () => ({ allowed: false as const }),
    );
  });

export const unlinkAccountFn = createServerFn({ method: "POST" })
  .validator(unlinkAccountSchema)
  .handler(async ({ data }) => {
    const [
      effects,
      server,
      _services,
      { SessionService },
      _admin,
      audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requireAuthenticatedActor(headers),
      "fn/user/unlink",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(SessionService, (service) =>
          service.unlinkAccount(headers, data.account_id),
        ).pipe(
          effects.Effect.tap(() =>
            audit.recordAuditEvent({
              actorUserId: trusted.userId,
              sessionId: trusted.sessionId,
              requestId,
              event: "auth.account.unlinked",
              outcome: "succeeded",
              resource: `account:${data.account_id}`,
            }),
          ),
        ),
      ),
      "fn/user/unlink",
      15000,
      requestId,
    ).then(() => ({ ok: true as const }));
  });

export const adminListUsersFn = createServerFn({ method: "GET" })
  .validator(adminUserQuerySchema)
  .handler(async ({ data }) => {
    const [
      effects,
      server,
      _services,
      _sessions,
      { UserAdminService },
      _audit,
      _authorization,
      _errors,
      session,
      { auth: _auth },
      { Actor },
      { withActor },
      { runApp },
      _roleService,
      _identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, [
        { resource: "user", actions: ["list"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/users",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(UserAdminService, (service) =>
          service.listUsers(Actor.Member({ userId: trusted.userId }), data.limit, data.offset),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorizationModule,
      _errors,
      session,
      { auth: _authAssign },
      { Actor },
      { withActor },
      { runApp },
      roleServiceModule,
      identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      effects.Effect.gen(function* () {
        const actor = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(actor);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["manage-roles"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return actor;
      }),
      "fn/admin/assign-role",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleServiceModule.RoleService, (service) =>
          service.assignRole(
            Actor.Member({ userId: trusted.userId }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorizationModule,
      _errors,
      session,
      { auth: _authRemove },
      { Actor },
      { withActor },
      { runApp },
      roleServiceModule,
      identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      effects.Effect.gen(function* () {
        const actor = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(actor);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["manage-roles"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return actor;
      }),
      "fn/admin/remove-role",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleServiceModule.RoleService, (service) =>
          service.removeRole(
            Actor.Member({ userId: trusted.userId }),
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
  const [
    effects,
    server,
    _services,
    _sessions,
    _admin,
    _audit,
    _authorizationModule2,
    _errors,
    session,
    { auth: _authList },
    { Actor },
    { withActor },
    { runApp },
    roleServiceModule,
    _identifiers,
  ] = await loadServer();

  const headers = server.getRequestHeaders();
  const requestId = crypto.randomUUID();

  const trusted = await runApp(
    session.requirePermission(headers, [{ resource: "role", actions: ["read"] }]),
    "fn/admin/roles",
    15000,
    requestId,
  );

  return runApp(
    withActor(
      Actor.Member({ userId: trusted.userId }),
      effects.Effect.flatMap(roleServiceModule.RoleService, (service) =>
        service.listRoles(Actor.Member({ userId: trusted.userId })),
      ),
    ),
    "fn/admin/roles",
    15000,
    requestId,
  );
});

export const adminSetRoleGrantsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      role_id: z.string().min(1).max(120),
      permissions: z.array(z.string().min(1).max(80)).max(100),
    }),
  )
  .handler(async ({ data }) => {
    const [
      effects,
      server,
      _services,
      _sessions,
      _admin,
      _audit,
      _authorizationModule3,
      _errors,
      session,
      { auth: _authGrants },
      { Actor },
      { withActor },
      { runApp },
      roleServiceModule,
      identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      effects.Effect.gen(function* () {
        const actor = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(actor);
        yield* session.requirePermission(headers, [
          { resource: "role", actions: ["manage-permissions"] },
        ]);

        return actor;
      }),
      "fn/admin/set-role-grants",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(roleServiceModule.RoleService, (service) =>
          service.setRoleGrants(
            Actor.Member({ userId: trusted.userId }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      { UserAdminService },
      _audit,
      _authorizationModule4,
      _errors,
      session,
      { auth: _authBan },
      { Actor },
      { withActor },
      { runApp },
      _roleServiceModule,
      identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      effects.Effect.gen(function* () {
        const actor = yield* session.requireAuthenticatedActor(headers);

        yield* session.requireRecentAuthentication(actor);
        yield* session.requirePermission(headers, [
          { resource: "user", actions: ["ban"] },
          { resource: "admin", actions: ["access"] },
        ]);

        return actor;
      }),
      "fn/admin/ban-user",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(UserAdminService, (service) =>
          service.banUser(
            Actor.Member({ userId: trusted.userId }),
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
    const [
      effects,
      server,
      _services,
      _sessions,
      { UserAdminService },
      _audit,
      _authorizationModule5,
      _errors,
      session,
      { auth: _authUnban },
      { Actor },
      { withActor },
      { runApp },
      _roleServiceModule2,
      identifiers,
    ] = await loadServer();

    const headers = server.getRequestHeaders();
    const requestId = crypto.randomUUID();

    const trusted = await runApp(
      session.requirePermission(headers, [
        { resource: "user", actions: ["ban"] },
        { resource: "admin", actions: ["access"] },
      ]),
      "fn/admin/unban-user",
      15000,
      requestId,
    );

    return runApp(
      withActor(
        Actor.Member({ userId: trusted.userId }),
        effects.Effect.flatMap(UserAdminService, (service) =>
          service.unbanUser(
            Actor.Member({ userId: trusted.userId }),
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
