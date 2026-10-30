import { Effect } from "effect";

import { UserRepository } from "@/modules/user/server/repository/user-repository";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

export type AuditOutcome = "succeeded" | "failed" | "denied";

/**
 * Request-scoped audit identity for privileged mutations. Services own the
 * event name, resource, and metadata; callers supply only the request
 * context they hold. The service writes the record in the same transaction
 * as the mutation (see RoleService/UserAdminService).
 */
export interface AuditContext {
  readonly requestId: string;
  readonly sessionId: string | null;
}

/**
 * Audit categories.
 *
 * Mandatory transactional audit: privileged, database-owned mutations
 * (role create/delete, grant changes, assignments, ban/unban). The record
 * is written in the mutation's transaction, so an audit failure rolls the
 * mutation back — no privileged change exists without its trail.
 *
 * Best-effort event audit: occurrences the application observes but does
 * not own transactionally (profile updates, favorites, session revocation
 * through Better Auth's provider, sign-in attempts). These run after the
 * decision they record, so an audit write failure can never turn a denial
 * into an allowance. A logging failure must never lock users out of
 * normal browsing.
 */
export const recordAuditEvent = (input: {
  readonly actorUserId: string | null;
  readonly sessionId: string | null;
  readonly requestId: string;
  readonly event: string;
  readonly outcome: AuditOutcome;
  readonly reason?: string | undefined;
  readonly resource?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}): Effect.Effect<void, DatabaseError, Database | UserRepository> =>
  Effect.flatMap(UserRepository, (repository) =>
    repository.insertAuditEvent({
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      event: input.event,
      outcome: input.outcome,
      reason: input.reason ?? null,
      resource: input.resource ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    }),
  );
