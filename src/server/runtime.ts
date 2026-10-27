import { Data, Duration, Effect, ManagedRuntime } from "effect";

import { AppLive } from "@/server/layers";
import type { AppServices } from "@/server/layers";

export class RequestTimeout extends Data.TaggedError("RequestTimeout")<{
  readonly operation: string;
}> {}

export const appRuntime = ManagedRuntime.make(AppLive);

export const withRequestTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  operation: string,
  timeoutMs: number,
): Effect.Effect<A, E | RequestTimeout, R> =>
  Effect.raceFirst(
    effect,
    Effect.fail(new RequestTimeout({ operation })).pipe(Effect.delay(Duration.millis(timeoutMs))),
  );

export const runApp = <A, E, R extends AppServices>(
  effect: Effect.Effect<A, E, R>,
  operation: string,
  timeoutMs: number,
  requestId: string,
): Promise<A> =>
  appRuntime.runPromise(
    withRequestTimeout(
      effect.pipe(Effect.annotateLogs({ requestId, operation })),
      operation,
      timeoutMs,
    ),
  );
