import { Context, Effect, Exit, Layer, Option, Schedule } from "effect";
import postgres from "postgres";

import { appConfig } from "@/server/config";
import {
  DatabaseUnavailable,
  TransactionConflict,
  TransactionFailed,
  describeCause,
  isConnectionFailure as isConnectionFailureShim,
} from "@/server/database/errors";

/** @deprecated Use `runQuery` instead; see `isConnectionFailure` in database/errors. */
export const isConnectionFailure = isConnectionFailureShim;

/**
 * Reylo-compatible PostgreSQL client. postgres.js pool clients and reserved
 * connections (which extend `Sql`) both satisfy Reylo's `UnsafeClient`
 * (`unsafe(text, params)`), so repository queries accept either.
 */
export type DbClient = postgres.Sql;

export class Database extends Context.Service<Database, { readonly sql: postgres.Sql }>()(
  "feastjourney/database/Database",
) {}

/**
 * Transaction-bound client. Repositories prefer it when present and fall back
 * to the pool otherwise, so single operations and transactional workflows share
 * the same query code without ever leaking a transaction client.
 */
export class TxSql extends Context.Service<TxSql, postgres.ReservedSql>()(
  "feastjourney/database/TxSql",
) {}

export const currentSql = Effect.gen(function* () {
  const override = yield* Effect.serviceOption(TxSql);

  if (Option.isSome(override)) {
    return override.value;
  }

  const db = yield* Database;

  return db.sql;
});

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* appConfig;

    const sql = postgres(config.databaseUrl, {
      max: config.poolMax,
      connect_timeout: 10,
      idle_timeout: 30,
      max_lifetime: 60 * 30,
      transform: { undefined: undefined },
      onnotice: () => {},
    });

    return yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const probe = yield* Effect.tryPromise({
          try: () => sql`SELECT 1 AS ok`,
          catch: () => new DatabaseUnavailable({ operation: "database/connect" }),
        });

        if (probe.length === 0) {
          return yield* new DatabaseUnavailable({ operation: "database/connect" });
        }

        return Database.of({ sql });
      }),
      (database) => Effect.promise(() => database.sql.end({ timeout: 5 })).pipe(Effect.ignore),
    );
  }),
);

/**
 * Serialization/deadlock retry budget: at most two retries with exponential
 * backoff (100ms, 200ms). Only TransactionConflict (40001/40P01) retries;
 * constraint violations, invalid SQL, and connection loss fail immediately.
 */
const TRANSACTION_RETRY_ATTEMPTS = 2;

const TRANSACTION_RETRY_SCHEDULE = Schedule.exponential("100 millis");

/**
 * Runs `effect` inside a single postgres.js transaction on one reserved
 * connection. Participating repositories resolve the transaction client
 * through `currentSql`, so no statement silently uses the pool mid-transaction.
 * The connection is released on success, failure, or interruption; commit
 * failures surface as `TransactionFailed`, while rollback failures are logged
 * and swallowed so the original failure is preserved.
 *
 * A serialization conflict or deadlock aborts the whole transaction, so the
 * retry wraps the full acquire/use/release attempt: each attempt reserves a
 * fresh connection and issues a new BEGIN. Attempts are bounded
 * (TRANSACTION_RETRY_ATTEMPTS with exponential backoff); an exhausted conflict
 * propagates as `TransactionConflict`, which maps to 503 like other transient
 * database failures. Only `TransactionConflict` retries — constraint
 * violations, invalid SQL, and connection loss fail immediately, and
 * interruptions never retry.
 */
export const withTransaction = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R | TxSql>,
): Effect.Effect<A, E | TransactionFailed, R | Database> =>
  Effect.flatMap(Database, (db) => {
    const attempt = Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          const tx = await db.sql.reserve();
          await tx.unsafe("BEGIN");

          return tx;
        },
        catch: (cause) =>
          new TransactionFailed({
            operation,
            cause: describeCause(cause),
          }),
      }),
      (tx) => Effect.provideService(effect, TxSql, tx),
      (tx, exit) =>
        Exit.isSuccess(exit)
          ? Effect.tryPromise({
              try: () => tx.unsafe("COMMIT").then(() => tx.release()),
              catch: (cause) =>
                new TransactionFailed({
                  operation,
                  cause: describeCause(cause),
                }),
            })
          : Effect.tryPromise({
              try: () => tx.unsafe("ROLLBACK").then(() => tx.release()),
              catch: (cause) =>
                new TransactionFailed({
                  operation,
                  cause: describeCause(cause),
                }),
            }).pipe(Effect.ignore, Effect.andThen(Effect.void)),
    );

    return Effect.retry(attempt, {
      while: (error) => error instanceof TransactionConflict,
      times: TRANSACTION_RETRY_ATTEMPTS,
      schedule: TRANSACTION_RETRY_SCHEDULE,
    });
  });

export const checkDatabaseHealth = Effect.gen(function* () {
  const db = yield* Database;

  const rows = yield* Effect.tryPromise({
    try: () => db.sql`SELECT 1 AS ok`,
    catch: () => new DatabaseUnavailable({ operation: "database/health" }),
  });

  if (rows.length === 0) {
    return yield* new DatabaseUnavailable({ operation: "database/health" });
  }

  return true as const;
});
