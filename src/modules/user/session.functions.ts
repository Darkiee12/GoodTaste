import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SessionLookupError } from "@/modules/user/server/operations/session-service";
import { sessionRevokeSchema, unlinkAccountSchema } from "@/modules/user/user.schema";
import { AuthProviderError } from "@/server/auth/errors";

/**
 * Session, account-linking, and sign-in-state server functions.
 *
 * Server-only dependencies stay behind the dynamic loader below so
 * browser bundles never execute server modules; each handler
 * destructures only the namespaces it uses.
 */
const loadServer = async () => {
  const [
    effects,
    server,
    sessions,
    audit,
    session,
    betterAuth,
    actor,
    currentActor,
    runtime,
    identifiers,
  ] = await Promise.all([
    import("effect"),
    import("@tanstack/react-start/server"),
    import("@/modules/user/server/operations/session-service"),
    import("@/modules/user/server/operations/audit"),
    import("@/server/auth/session"),
    import("@/server/auth/better-auth"),
    import("@/server/auth/actor"),
    import("@/server/auth/current-actor"),
    import("@/server/runtime"),
    import("@/modules/user/server/domain/identifiers"),
  ]);

  return {
    effects,
    server,
    sessions,
    audit,
    session,
    betterAuth,
    actor,
    currentActor,
    runtime,
    identifiers,
  };
};

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
