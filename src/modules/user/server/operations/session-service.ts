import { Context, Data, Effect, Layer } from "effect";

import { UnlinkDenied } from "@/modules/user/server/domain/errors";
import { auth } from "@/server/auth/better-auth";
import type { DatabaseError } from "@/server/database/query";

export interface SessionSummary {
  readonly token: string;
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

const toSummary = (
  session: {
    readonly token: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly expiresAt: Date;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
  },
  currentToken: string,
): SessionSummary => ({
  token: session.token,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  expiresAt: session.expiresAt,
  ipAddress: session.ipAddress ?? null,
  userAgent: session.userAgent ?? null,
  current: session.token === currentToken,
});

const lookupFailure = (operation: string, cause: unknown): SessionLookupError =>
  new SessionLookupError({
    reason: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

export class SessionService extends Context.Service<
  SessionService,
  {
    readonly listSessions: (
      headers: Headers,
    ) => Effect.Effect<ReadonlyArray<SessionSummary>, SessionLookupError>;
    readonly revokeSession: (
      headers: Headers,
      token: string,
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
      const current = yield* Effect.promise(() => auth.api.getSession({ headers })).pipe(
        Effect.mapError((cause) => lookupFailure("session/current", cause)),
      );

      if (current === null) {
        return [];
      }

      const sessions = yield* Effect.promise(() => auth.api.listSessions({ headers })).pipe(
        Effect.mapError((cause) => lookupFailure("session/list", cause)),
      );

      return sessions.map((session) => toSummary(session, current.session.token));
    }),
  revokeSession: (headers, token) =>
    Effect.promise(() => auth.api.revokeSession({ body: { token }, headers })).pipe(
      Effect.mapError((cause) => lookupFailure("session/revoke", cause)),
      Effect.asVoid,
    ),
  revokeOtherSessions: (headers) =>
    Effect.promise(() => auth.api.revokeOtherSessions({ headers })).pipe(
      Effect.mapError((cause) => lookupFailure("session/revoke-others", cause)),
      Effect.asVoid,
    ),
  revokeAllSessions: (headers) =>
    Effect.promise(() => auth.api.revokeSessions({ headers })).pipe(
      Effect.mapError((cause) => lookupFailure("session/revoke-all", cause)),
      Effect.asVoid,
    ),
  unlinkAccount: (headers, accountId) =>
    Effect.gen(function* () {
      const accounts = yield* Effect.promise(() => auth.api.listUserAccounts({ headers })).pipe(
        Effect.mapError((cause) => lookupFailure("session/accounts", cause)),
      );

      if (accounts.length <= 1) {
        return yield* new UnlinkDenied({
          reason: "cannot remove the last remaining sign-in method",
        });
      }

      return yield* Effect.promise(() =>
        auth.api.unlinkAccount({ body: { accountId }, headers }),
      ).pipe(Effect.mapError((cause) => lookupFailure("session/unlink", cause)));
    }),
});

export type SessionServiceError = SessionLookupError | DatabaseError;
