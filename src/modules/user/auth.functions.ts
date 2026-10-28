import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { AuthProviderError } from "@/server/auth/errors";

/**
 * Signup, sign-in, recovery, and password server functions.
 *
 * Server-only dependencies stay behind the dynamic loader below so
 * browser bundles never execute server modules; each handler
 * destructures only the namespaces it uses.
 */
const loadServer = async () => {
  const [effects, server, audit, session, betterAuth, actor, currentActor, runtime] =
    await Promise.all([
      import("effect"),
      import("@tanstack/react-start/server"),
      import("@/modules/user/server/operations/audit"),
      import("@/server/auth/session"),
      import("@/server/auth/better-auth"),
      import("@/server/auth/actor"),
      import("@/server/auth/current-actor"),
      import("@/server/runtime"),
    ]);

  return {
    effects,
    server,
    audit,
    session,
    betterAuth,
    actor,
    currentActor,
    runtime,
  };
};

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
