import { Data, Option, Schema } from "effect";
import postgres from "postgres";

export class DatabaseUnavailable extends Data.TaggedError("DatabaseUnavailable")<{
  readonly operation: string;
}> {}

export class PersistenceConflict extends Data.TaggedError("PersistenceConflict")<{
  readonly operation: string;
  readonly constraint: string | undefined;
}> {}

export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  readonly operation: string;
  readonly cause: string;
}> {}

export class TransactionFailed extends Data.TaggedError("TransactionFailed")<{
  readonly operation: string;
  readonly cause: string;
}> {}

/**
 * Transient serialization or deadlock failure (SQLSTATE 40001/40P01). The
 * statement was aborted before committing, so the whole transaction may be
 * retried. Retried at the transaction boundary only; never constructed for
 * constraint violations, invalid SQL, or connection loss.
 */
export class TransactionConflict extends Data.TaggedError("TransactionConflict")<{
  readonly operation: string;
  readonly code: "40001" | "40P01";
  readonly cause: string;
}> {}

/** Renders an unknown throwable for a typed failure payload. */
export const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const DriverCode = Schema.UndefinedOr(Schema.String);

/**
 * SQLSTATE or driver code for a rejection, when the driver provides one.
 * postgres.js surfaces server failures as PostgresError with the SQLSTATE
 * `code`; connection teardown and socket failures carry driver codes
 * (ECONNREFUSED, CONNECTION_CLOSED, ...). Anything else yields undefined.
 * Boundary parsing, not representation sniffing: the raw `code` member is
 * decoded through a Schema into `string | undefined`.
 */
const driverCodeOf = (cause: unknown): string | undefined => {
  if (cause instanceof postgres.PostgresError) {
    return cause.code;
  }

  if (cause instanceof Error && "code" in cause) {
    return Option.getOrUndefined(Schema.decodeUnknownOption(DriverCode)(cause.code));
  }

  return undefined;
};

const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
]);

const isConnectionCode = (code: string): boolean =>
  code === "53300" || code.startsWith("08") || CONNECTION_CODES.has(code);

/**
 * @deprecated Use `runQuery` (which classifies via `classifyDatabaseError`)
 * instead of hand-rolled failure mapping. Kept temporarily for in-flight
 * callers; implemented with the same code-based rules, no message matching.
 */
export const isConnectionFailure = (cause: unknown): boolean => {
  const code = driverCodeOf(cause);

  return code === undefined ? false : isConnectionCode(code);
};

const constraintOf = (cause: unknown): string | undefined =>
  cause instanceof postgres.PostgresError ? (cause.constraint_name ?? undefined) : undefined;

/**
 * Single classification point for database operation failures. Code-based:
 * connection/SQLSTATE-class failures come from driver metadata, never message
 * matching. The rendered `cause` string is preserved for logs and debugging;
 * nothing here decides what clients may see (see api-error mapping).
 */
export const classifyDatabaseError = (
  operation: string,
  cause: unknown,
): DatabaseUnavailable | PersistenceError | PersistenceConflict | TransactionConflict => {
  const code = driverCodeOf(cause);

  if (code === "40001" || code === "40P01") {
    return new TransactionConflict({ operation, code, cause: describeCause(cause) });
  }

  if (code === "23505") {
    return new PersistenceConflict({ operation, constraint: constraintOf(cause) });
  }

  if (code !== undefined && isConnectionCode(code)) {
    return new DatabaseUnavailable({ operation });
  }

  return new PersistenceError({ operation, cause: describeCause(cause) });
};
