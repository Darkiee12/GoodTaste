import { Effect } from "effect";

import { type Database, type DbClient, currentSql } from "@/server/database/client";
import { classifyDatabaseError } from "@/server/database/errors";
import type {
  DatabaseUnavailable,
  PersistenceConflict,
  PersistenceError,
  TransactionConflict,
} from "@/server/database/errors";

export type DatabaseError =
  | DatabaseUnavailable
  | PersistenceError
  | PersistenceConflict
  | TransactionConflict;

/**
 * The single execution boundary for database operations. The query thunk
 * receives the ambient client — the transaction connection when inside
 * `withTransaction`, the pool otherwise — so no call site can accidentally
 * bypass a transaction, and no new connection is acquired here.
 *
 * The thunk runs lazily (once per execution, inside `Effect.tryPromise`),
 * the inferred Reylo result type (`Row[]`, `Row | null`, `Row`, `void`)
 * flows through untouched, and driver rejections map to typed failures via
 * SQLSTATE/driver codes. Post-query mapping stays outside: pass only the
 * driver promise, never domain logic. There is no retry here; transient
 * conflicts retry at the transaction boundary in `withTransaction`.
 */
export const runQuery = <A>(
  operation: string,
  task: (sql: DbClient) => Promise<A>,
): Effect.Effect<A, DatabaseError, Database> =>
  Effect.flatMap(currentSql, (sql) =>
    Effect.tryPromise({
      try: () => task(sql),
      catch: (cause) => classifyDatabaseError(operation, cause),
    }),
  );
