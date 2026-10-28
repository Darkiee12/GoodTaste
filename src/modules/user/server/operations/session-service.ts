import { Context, Data, Effect, Layer } from "effect";

import { UnlinkDenied } from "@/modules/user/server/domain/errors";
import type { SessionId } from "@/modules/user/server/domain/identifiers";
import { auth } from "@/server/auth/better-auth";
import type { DatabaseError } from "@/server/database/query";

/**
 * Browser-safe session summary. The bearer `token` never leaves the server:
 * revocation resolves the token internally from the session `id` after
 * verifying it belongs to the caller. `id` is a non-authenticating record
 * reference safe to render as a React key or send back for revocation.
 */
export interface SessionSummary {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly current: boolean;
}

export class SessionLookupError extends Data.TaggedError("SessionLookupError")<{
  readonly reason: string;
}> {}

interface ProviderSession {
  readonly id: string;
  readonly token: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}

const toSummary = (session: ProviderSession, currentId: string): SessionSummary => ({
  id: session.id,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  expiresAt: session.expiresAt,
  ipAddress: session.ipAddress ?? null,
  userAgent: session.userAgent ?? null,
  current: session.id === currentId,
});

const lookupFailure = (operation: string, cause: unknown): SessionLookupError =>
  new SessionLookupError({
    reason: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const currentSession = (headers: Headers) =>
  Effect.tryPromise({
    try: () => auth.api.getSession({ headers }),
    catch: (cause) => lookupFailure("session/current", cause),
  });

const allSessions = (headers: Headers) =>
  Effect.tryPromise({
    try: () => auth.api.listSessions({ headers }),
    catch: (cause) => lookupFailure("session/list", cause),
  });

export class SessionService extends Context.Service<
  SessionService,
  {
    readonly listSessions: (
      headers: Headers,
    ) => Effect.Effect<ReadonlyArray<SessionSummary>, SessionLookupError>;
    readonly revokeSession: (
      headers: Headers,
      sessionId: SessionId,
    ) => Effect.Effect<void, SessionLookupError>;
    readonly revokeOtherSessions: (headers: Headers) => Effect.Effect<void, SessionLookupError>;
    readonly revokeAllSessions: (headers: Headers) => Effect.Effect<void, SessionLookupError>;
    readonly unlinkAccount: (
      headers: Headers,
      accountId: string,
    ) => Effect.Effect<void, SessionLookupError | UnlinkDenied>;
  }
>()("feastjourney/user/SessionService") {}

export const SessionServiceLive = Layer.succeed(SessionService, {
  listSessions: (headers) =>
    Effect.gen(function* () {
      const current = yield* currentSession(headers);

      if (current === null) {
        return [];
      }

      // SAFETY: list-sessions returns the documented session records
      // ({id, token, userId, ...}); the bearer token is used only here to
      // revoke after the userId ownership check below, never serialized.
      const sessions = (yield* allSessions(headers)) as ReadonlyArray<ProviderSession>;

      return sessions.map((session) => toSummary(session, current.session.id));
    }),
  revokeSession: (headers, sessionId) =>
    Effect.gen(function* () {
      const current = yield* currentSession(headers);

      if (current === null) {
        return yield* new SessionLookupError({ reason: "session/revoke: no active session" });
      }

      // SAFETY: same documented shape as above; only id/userId are read
      // before ownership is established, and the token stays server-side.
      const sessions = (yield* allSessions(headers)) as ReadonlyArray<ProviderSession>;
      const target = sessions.find((session) => session.id === sessionId);

      // Unknown ids and other users' sessions fail identically: the response
      // must not reveal which sessions exist.
      if (target === undefined || target.userId !== current.user.id) {
        return yield* new SessionLookupError({ reason: "session/revoke: unknown session" });
      }

      return yield* Effect.tryPromise({
        try: () => auth.api.revokeSession({ body: { token: target.token }, headers }),
        catch: (cause) => lookupFailure("session/revoke", cause),
      });
    }),
  revokeOtherSessions: (headers) =>
    Effect.tryPromise({
      try: () => auth.api.revokeOtherSessions({ headers }),
      catch: (cause) => lookupFailure("session/revoke-others", cause),
    }).pipe(Effect.asVoid),
  revokeAllSessions: (headers) =>
    Effect.tryPromise({
      try: () => auth.api.revokeSessions({ headers }),
      catch: (cause) => lookupFailure("session/revoke-all", cause),
    }).pipe(Effect.asVoid),
  unlinkAccount: (headers, accountId) =>
    Effect.gen(function* () {
      const accounts = yield* Effect.tryPromise({
        try: () => auth.api.listUserAccounts({ headers }),
        catch: (cause) => lookupFailure("session/accounts", cause),
      });

      if (accounts.length <= 1) {
        return yield* new UnlinkDenied({
          reason: "cannot remove the last remaining sign-in method",
        });
      }

      return yield* Effect.tryPromise({
        try: () => auth.api.unlinkAccount({ body: { accountId }, headers }),
        catch: (cause) => lookupFailure("session/unlink", cause),
      });
    }),
});

export type SessionServiceError = SessionLookupError | DatabaseError;
