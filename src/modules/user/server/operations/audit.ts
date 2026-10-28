import { Effect } from "effect";

import { UserRepository } from "@/modules/user/server/repository/user-repository";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

export type AuditOutcome = "succeeded" | "failed" | "denied";

/**
 * Append-only security audit. Runs after the authorization decision it
 * records, so an audit write failure can never turn a denial into an
 * allowance. Callers attach it with `Effect.tap` / `Effect.tapBoth` and a
 * logged fallback; the security decision itself never depends on the insert.
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
