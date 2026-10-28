import { afterAll, describe, expect, test } from "bun:test";

import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import postgres from "postgres";

import { Database, withTransaction } from "@/server/database/client";
import {
  TransactionConflict,
  TransactionFailed,
  classifyDatabaseError,
  isConnectionFailure,
} from "@/server/database/errors";
import { runQuery } from "@/server/database/query";

// Never connects: used only for thunks that ignore the client.
const idleSql = postgres("postgres://127.0.0.1:1/unused", { max: 1 });
const idleDatabase = Layer.succeed(Database, { sql: idleSql });

// Retry mechanics reserve real connections but bodies issue no SQL and
// create no rows; the server only sees empty BEGIN/COMMIT/ROLLBACK pairs.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney";

const liveSql = postgres(databaseUrl, { max: 5 });
const liveDatabase = Layer.succeed(Database, { sql: liveSql });

afterAll(async () => {
  await idleSql.end();
  await liveSql.end();
});

const runIdle = <A, E>(effect: Effect.Effect<A, E, Database>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, idleDatabase));

const flipIdle = <A, E>(effect: Effect.Effect<A, E, Database>): Promise<E> =>
  Effect.runPromise(Effect.provide(Effect.flip(effect), idleDatabase));

// Mirrors the driver's own construction: PostgresError carries a message,
// then the server fields (SQLSTATE code, constraint name) are assigned on.
const postgresFailure = (
  message: string,
  fields: { code: string; constraint_name?: string },
): postgres.PostgresError => Object.assign(new postgres.PostgresError(message), fields);

const runLive = <A, E>(effect: Effect.Effect<A, E, Database>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, liveDatabase));

describe("runQuery execution boundary", () => {
  test("does not execute the thunk until the effect runs, then runs it exactly once", async () => {
    let calls = 0;

    const effect = runQuery("test/lazy", () => {
      calls += 1;

      return Promise.resolve("done");
    });

    expect(calls).toBe(0);
    expect(await runIdle(effect)).toBe("done");
    expect(calls).toBe(1);
  });

  test("passes result shapes through untouched: arrays, nulls, and single rows", async () => {
    const rows = [{ id: 1n }, { id: 2n }];

    expect(await runIdle(runQuery("test/many", () => Promise.resolve(rows)))).toEqual(rows);
    expect(await runIdle(runQuery("test/maybe-one", () => Promise.resolve(null)))).toBeNull();

    const single = { total: 42 };
    const one = runQuery("test/one", () => Promise.resolve(single));
    expect(await runIdle(one)).toBe(single);
  });

  test("routes through the ambient transaction client when one is present", async () => {
    let seen: unknown;
    await runLive(
      withTransaction(
        "test/tx-route",
        runQuery("test/route", (sql) => {
          seen = sql;

          return Promise.resolve("ok");
        }),
      ),
    );

    expect(seen).not.toBe(liveSql);
  });

  test("classifies unique violations with the server constraint name", async () => {
    const failure = await flipIdle(
      runQuery("test/unique", () =>
        Promise.reject(
          postgresFailure('duplicate key value violates unique constraint "dish_slug_key"', {
            code: "23505",
            constraint_name: "dish_slug_key",
          }),
        ),
      ),
    );

    expect(failure._tag).toBe("PersistenceConflict");
    expect(failure).toMatchObject({ operation: "test/unique", constraint: "dish_slug_key" });
  });

  test("classifies serialization failures and deadlocks as retryable conflicts", async () => {
    const failures = await Promise.all(
      (["40001", "40P01"] as const).map((code) =>
        flipIdle(
          runQuery("test/conflict", () =>
            Promise.reject(postgresFailure("could not serialize", { code })),
          ),
        ),
      ),
    );

    expect(failures.map((failure) => failure._tag)).toEqual([
      "TransactionConflict",
      "TransactionConflict",
    ]);
    expect(failures[0]).toMatchObject({ operation: "test/conflict", code: "40001" });
    expect(failures[1]).toMatchObject({ operation: "test/conflict", code: "40P01" });
  });

  test("classifies connection loss by code, not message", async () => {
    const refused = await flipIdle(
      runQuery("test/outage", () =>
        Promise.reject(Object.assign(new Error("boom"), { code: "ECONNREFUSED" })),
      ),
    );

    expect(refused._tag).toBe("DatabaseUnavailable");

    const exhausted = await flipIdle(
      runQuery("test/full", () => Promise.reject(postgresFailure("full", { code: "53300" }))),
    );

    expect(exhausted._tag).toBe("DatabaseUnavailable");

    const closed = await flipIdle(
      runQuery("test/closed", () =>
        Promise.reject(Object.assign(new Error("x"), { code: "CONNECTION_CLOSED" })),
      ),
    );

    expect(closed._tag).toBe("DatabaseUnavailable");
  });

  test("keeps the rendered cause on generic failures", async () => {
    const generic = await flipIdle(
      runQuery("test/broken", () => Promise.reject(new Error("syntax error at end"))),
    );

    expect(generic).toMatchObject({ operation: "test/broken", cause: "syntax error at end" });

    const thrown = await flipIdle(runQuery("test/string", () => Promise.reject("nope")));
    expect(thrown).toMatchObject({ operation: "test/string", cause: "nope" });
  });

  test("surfaces a refused connection as DatabaseUnavailable", async () => {
    const down = postgres("postgres://127.0.0.1:54339/unused", { connect_timeout: 2, max: 1 });

    try {
      const failure = await Effect.runPromise(
        Effect.provide(
          Effect.flip(runQuery("test/down", (sql) => sql`SELECT 1`)),
          Layer.succeed(Database, { sql: down }),
        ),
      );

      expect(failure._tag).toBe("DatabaseUnavailable");
    } finally {
      await down.end();
    }
  });

  test("deprecated isConnectionFailure agrees with code-based classification", async () => {
    expect(isConnectionFailure(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isConnectionFailure(postgresFailure("x", { code: "40001" }))).toBe(false);
    expect(isConnectionFailure(new Error("plain"))).toBe(false);
    expect(classifyDatabaseError("test/op", new Error("plain"))._tag).toBe("PersistenceError");
  });
});

describe("withTransaction resource finalization", () => {
  interface FakeReserved {
    readonly unsafe: (query: string) => Promise<ReadonlyArray<never>>;
    // Synchronous like postgres.js release(): void. A throwing release
    // surfaces through the surrounding promise chain or try/finally.
    readonly release: () => void;
  }

  const fakeLayer = (events: Array<string>, failPhase: string | null) => {
    // Fault injection patches reserve at runtime on a real client that
    // never connects (dead port, overridden before first use). This keeps
    // every type precise with no assertions: the double flows through the
    // production withTransaction path exactly as a live pool would.
    const pooled = postgres("postgres://127.0.0.1:1/unused", { max: 1 });

    const reserve = async (): Promise<FakeReserved> => {
      events.push("reserve");

      if (failPhase === "reserve") {
        throw new Error("reserve failed");
      }

      const unsafe = async (query: string): Promise<ReadonlyArray<never>> => {
        events.push(query);

        if (query === failPhase) {
          throw new Error(`${query} failed`);
        }

        return [];
      };

      const release = (): void => {
        events.push("release");

        if (failPhase === "release") {
          throw new Error("release failed");
        }
      };

      return { unsafe, release };
    };

    Object.defineProperty(pooled, "reserve", { value: reserve });

    return { layer: Layer.succeed(Database, { sql: pooled }), pooled };
  };

  const runFakeFailure = async (
    failPhase: string | null,
    body: Effect.Effect<unknown, Error, Database>,
  ): Promise<{ failure: Error | TransactionFailed; events: Array<string> }> => {
    const events: Array<string> = [];
    const { layer, pooled } = fakeLayer(events, failPhase);

    try {
      const failure = await Effect.runPromise(
        Effect.provide(Effect.flip(withTransaction("test/finalize", body)), layer),
      );

      return { failure, events };
    } finally {
      await pooled.end();
    }
  };

  test("releases the reservation when BEGIN fails", async () => {
    const { failure, events } = await runFakeFailure("BEGIN", Effect.void);

    expect(failure).toBeInstanceOf(TransactionFailed);
    expect(events).toEqual(["reserve", "BEGIN", "release"]);
  });

  test("releases the connection when COMMIT fails", async () => {
    const { failure, events } = await runFakeFailure("COMMIT", Effect.void);

    expect(failure).toBeInstanceOf(TransactionFailed);
    expect(events).toEqual(["reserve", "BEGIN", "COMMIT", "release"]);
  });

  test("rolls back, releases, and preserves the original failure", async () => {
    const stable = new Error("body failed");
    const { failure, events } = await runFakeFailure(null, Effect.fail(stable));

    expect(failure).toBe(stable);
    expect(events).toEqual(["reserve", "BEGIN", "ROLLBACK", "release"]);
  });

  test("a failed ROLLBACK cannot mask the original failure and still releases", async () => {
    const stable = new Error("body failed");
    const { failure, events } = await runFakeFailure("ROLLBACK", Effect.fail(stable));

    expect(failure).toBe(stable);
    expect(events).toEqual(["reserve", "BEGIN", "ROLLBACK", "release"]);
  });

  test("a failed release on the success path surfaces instead of succeeding silently", async () => {
    const { failure, events } = await runFakeFailure("release", Effect.void);

    expect(failure).toBeInstanceOf(TransactionFailed);
    expect(events).toEqual(["reserve", "BEGIN", "COMMIT", "release"]);
  });

  test("a failed release on the rollback path still preserves the original failure", async () => {
    const stable = new Error("body failed");
    const { failure, events } = await runFakeFailure("release", Effect.fail(stable));

    expect(failure).toBe(stable);
    expect(events).toEqual(["reserve", "BEGIN", "ROLLBACK", "release"]);
  });

  test("a refused reservation fails without anything to release", async () => {
    const { failure, events } = await runFakeFailure("reserve", Effect.void);

    expect(failure).toBeInstanceOf(TransactionFailed);
    expect(events).toEqual(["reserve"]);
  });

  test("the happy path issues exactly one BEGIN/COMMIT pair", async () => {
    const events: Array<string> = [];
    const { layer, pooled } = fakeLayer(events, null);

    try {
      const exit = await Effect.runPromise(
        Effect.provide(Effect.exit(withTransaction("test/finalize", Effect.succeed("ok"))), layer),
      );

      expect(exit).toEqual(Exit.succeed("ok"));
      expect(events).toEqual(["reserve", "BEGIN", "COMMIT", "release"]);
    } finally {
      await pooled.end();
    }
  });
});

describe("withTransaction retry", () => {
  test("retries serialization conflicts with a fresh connection and commits once", async () => {
    let attempts = 0;

    const result = await runLive(
      withTransaction(
        "test/retry",
        Effect.gen(function* () {
          attempts += 1;

          if (attempts <= 2) {
            return yield* new TransactionConflict({
              operation: "test/retry",
              code: "40001",
              cause: `conflict-${attempts}`,
            });
          }

          return "committed";
        }),
      ),
    );

    expect(result).toBe("committed");
    expect(attempts).toBe(3);
  });

  test("gives up after the bounded budget and surfaces the last conflict", async () => {
    let attempts = 0;

    const failure = await runLive(
      Effect.flip(
        withTransaction(
          "test/giveup",
          Effect.gen(function* () {
            attempts += 1;

            return yield* new TransactionConflict({
              operation: "test/giveup",
              code: "40P01",
              cause: "deadlock",
            });
          }),
        ),
      ),
    );

    expect(attempts).toBe(3);
    expect(failure).toBeInstanceOf(TransactionConflict);
    expect(failure).toMatchObject({ operation: "test/giveup", code: "40P01" });
  });

  test("never retries generic failures and preserves them", async () => {
    let attempts = 0;
    const stable = new Error("boom");

    const failure = await runLive(
      Effect.flip(
        withTransaction(
          "test/stable",
          Effect.gen(function* () {
            attempts += 1;

            return yield* Effect.fail(stable);
          }),
        ),
      ),
    );

    expect(attempts).toBe(1);
    expect(failure).toBe(stable);
  });

  test("releases the connection without retrying on interruption", async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let attempts = 0;

    const body = Effect.andThen(
      Deferred.succeed(started, undefined),
      Effect.gen(function* () {
        attempts += 1;

        return yield* Effect.never;
      }),
    );

    const fiber = await Effect.runPromise(
      Effect.forkDetach(Effect.provide(withTransaction("test/interrupt", body), liveDatabase)),
    );

    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(attempts).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});
