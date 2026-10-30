import { Effect } from "effect";

import { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import { auth } from "@/server/auth/better-auth";
import {
  type InsufficientPermissions,
  OwnershipDenied,
  RecentAuthenticationRequired,
  SignInRequired,
  UserSuspended,
} from "@/server/auth/errors";
import type { PermissionRequest } from "@/server/auth/permissions";
import type { Database } from "@/server/database/client";
import { DatabaseUnavailable } from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";

/**
 * Server-trusted session identity. Built only from a verified Better Auth
 * session lookup; never from client input. Authorization is evaluated
 * separately against the database on every protected operation (see
 * `Authorization`), so role changes apply immediately without waiting for
 * session expiry.
 */
export interface TrustedSession {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly sessionId: string;
  readonly sessionCreatedAt: Date;
}

interface ResolvedSession {
  readonly session: {
    readonly id: string;
    readonly createdAt: Date;
  };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly banned?: boolean | null;
  };
}

const toTrustedSession = (
  resolved: ResolvedSession,
): Effect.Effect<TrustedSession, UserSuspended> =>
  resolved.user.banned === true
    ? Effect.fail(new UserSuspended({ reason: "account is suspended" }))
    : Effect.succeed({
        userId: resolved.user.id,
        email: resolved.user.email,
        name: resolved.user.name,
        sessionId: resolved.session.id,
        sessionCreatedAt: resolved.session.createdAt,
      } satisfies TrustedSession);

export const resolveSession = (
  headers: Headers,
): Effect.Effect<TrustedSession, SignInRequired | UserSuspended | DatabaseUnavailable> =>
  Effect.gen(function* () {
    // SAFETY: Better Auth's client types are any-laden; ResolvedSession
    // names the documented get-session shape and every field is
    // defensively checked (null session, banned flag). A rejected lookup
    // means the session store is unreachable, which is distinct from "no
    // session": it fails as DatabaseUnavailable (503) rather than
    // masquerading as an anonymous visitor.
    const resolved = (yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: () => new DatabaseUnavailable({ operation: "session/get" }),
    })) as ResolvedSession | null;

    if (resolved === null) {
      return yield* new SignInRequired({ required: "member" });
    }

    return yield* toTrustedSession(resolved);
  });

export const requireAuthenticatedActor = (
  headers: Headers,
): Effect.Effect<TrustedSession, SignInRequired | UserSuspended | DatabaseUnavailable> =>
  resolveSession(headers);

/**
 * Three-stage gate used by every protected operation:
 * 1. authentication (valid session, not suspended) — 401 territory;
 * 2. authorization (effective database grants cover the request) — 403;
 * 3. ownership and domain policy (checked by the operation itself).
 */
export const requirePermission = (
  headers: Headers,
  permissions: PermissionRequest | ReadonlyArray<PermissionRequest>,
): Effect.Effect<
  TrustedSession,
  SignInRequired | UserSuspended | InsufficientPermissions | DatabaseError,
  Database | RoleRepository | Authorization
> =>
  Effect.gen(function* () {
    const trusted = yield* resolveSession(headers);
    const actor = Actor.Member({ userId: trusted.userId });

    const checks: ReadonlyArray<PermissionRequest> = Array.isArray(permissions)
      ? permissions
      : [permissions];

    for (const check of checks) {
      yield* Effect.flatMap(Authorization, (authorization) => authorization.require(actor, check));
    }

    return trusted;
  });

export const checkOwnership = (
  ownerUserId: string,
  actorUserId: string,
  resource: string,
): Effect.Effect<void, OwnershipDenied> =>
  ownerUserId === actorUserId
    ? Effect.void
    : Effect.fail(new OwnershipDenied({ reason: `not the owner of ${resource}` }));

const RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000;

export const requireRecentAuthentication = (
  trusted: TrustedSession,
): Effect.Effect<void, RecentAuthenticationRequired> =>
  Date.now() - trusted.sessionCreatedAt.getTime() <= RECENT_AUTH_WINDOW_MS
    ? Effect.void
    : Effect.fail(
        new RecentAuthenticationRequired({
          reason: "sensitive action requires a fresh sign-in",
        }),
      );
