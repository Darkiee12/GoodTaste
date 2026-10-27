import { Context, Effect, Exit, Layer, Option } from "effect";
import postgres from "postgres";

import { appConfig } from "@/server/config";
import { DatabaseUnavailable, TransactionFailed } from "@/server/database/errors";

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

export const isConnectionFailure = (cause: unknown): boolean => {
  if (cause instanceof Error) {
    return (
      cause.message.includes("ECONNREFUSED") ||
      cause.message.includes("ENOTFOUND") ||
      cause.message.includes("ETIMEDOUT") ||
      cause.message.includes("Connection terminated") ||
      cause.message.includes("too many clients")
    );
  }

  return false;
};

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
 * Runs `effect` inside a single postgres.js transaction on one reserved
 * connection. Participating repositories resolve the transaction client
 * through `currentSql`, so no statement silently uses the pool mid-transaction.
 * The connection is released on success, failure, or interruption; commit
 * failures surface as `TransactionFailed`, while rollback failures are logged
 * and swallowed so the original failure is preserved.
 */
export const withTransaction = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R | TxSql>,
): Effect.Effect<A, E | TransactionFailed, R | Database> =>
  Effect.flatMap(Database, (db) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          const tx = await db.sql.reserve();
          await tx.unsafe("BEGIN");

          return tx;
        },
        catch: (cause) =>
          new TransactionFailed({
            operation,
            cause: cause instanceof Error ? cause.message : String(cause),
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
                  cause: cause instanceof Error ? cause.message : String(cause),
                }),
            })
          : Effect.tryPromise({
              try: () => tx.unsafe("ROLLBACK").then(() => tx.release()),
              catch: (cause) =>
                new TransactionFailed({
                  operation,
                  cause: cause instanceof Error ? cause.message : String(cause),
                }),
            }).pipe(Effect.ignore, Effect.andThen(Effect.void)),
    ),
  );

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
