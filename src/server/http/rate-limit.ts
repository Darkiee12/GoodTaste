import { Context, Duration, Effect, Layer, Match } from "effect";
import { RateLimiter } from "effect/persistence";

import { appConfig } from "@/server/config";
import { RateLimitExceeded, StoreUnavailable } from "@/server/http/api-error";

export type RateLimitBucket = "public" | "search" | "admin";

export class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  {
    readonly check: (
      bucket: RateLimitBucket,
      identity: string,
    ) => Effect.Effect<void, RateLimitExceeded | StoreUnavailable, RateLimiter.RateLimiter>;
  }
>()("feastjourney/http/RateLimitPolicy") {}

export const RateLimitPolicyLive = Layer.effect(
  RateLimitPolicy,
  Effect.gen(function* () {
    const config = yield* appConfig;

    const budgets: Record<
      RateLimitBucket,
      { readonly limit: number; readonly windowSeconds: number }
    > = {
      public: { limit: config.publicRateLimit, windowSeconds: config.publicRateWindowSeconds },
      search: { limit: config.searchRateLimit, windowSeconds: config.searchRateWindowSeconds },
      admin: { limit: config.adminRateLimit, windowSeconds: config.adminRateWindowSeconds },
    };

    return RateLimitPolicy.of({
      check: (bucket, identity) =>
        Effect.gen(function* () {
          const limiter = yield* RateLimiter.RateLimiter;
          const budget = budgets[bucket];

          yield* Effect.mapError(
            limiter.consume({
              algorithm: "fixed-window",
              onExceeded: "fail",
              window: Duration.seconds(budget.windowSeconds),
              limit: budget.limit,
              key: `feastjourney:${bucket}:${identity}`,
            }),
            (failure): RateLimitExceeded | StoreUnavailable =>
              Match.value(failure.reason).pipe(
                Match.tag(
                  "RateLimitExceeded",
                  (reason) =>
                    new RateLimitExceeded({
                      retryAfterSeconds: Math.max(
                        1,
                        Math.ceil(Duration.toMillis(reason.retryAfter) / 1000),
                      ),
                      limit: reason.limit,
                    }),
                ),
                Match.orElse(() => new StoreUnavailable({ operation: `ratelimit/${bucket}` })),
              ),
          );
        }),
    });
  }),
);

export const RateLimiterLive = Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory);
