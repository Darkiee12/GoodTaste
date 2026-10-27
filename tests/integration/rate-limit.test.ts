import { afterAll, describe, expect, test } from "bun:test";

import { Duration, Effect, Layer, ManagedRuntime, Match } from "effect";
import { RateLimiter } from "effect/persistence";

import { troubleCodeFor } from "@/server/http/api-error";
import { rateLimitHeaders } from "@/server/http/request";

const TestLive = Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory);
const runtime = ManagedRuntime.make(TestLive);

afterAll(async () => {
  await runtime.dispose();
});

const consume = (key: string, limit: number, windowSeconds: number) =>
  runtime.runPromise(
    Effect.flatMap(RateLimiter.RateLimiter, (limiter) =>
      limiter
        .consume({
          algorithm: "fixed-window",
          onExceeded: "fail",
          window: Duration.seconds(windowSeconds),
          limit,
          key,
        })
        .pipe(
          Effect.match({
            onFailure: (failure) => ({ limited: true as const, failure }),
            onSuccess: () => ({ limited: false as const, failure: null }),
          }),
        ),
    ),
  );

describe("rate limiting", () => {
  test("fixed window rejects over-limit consumers with retry metadata", async () => {
    const key = `test-public-${Date.now().toString(36)}`;

    expect((await consume(key, 2, 60)).limited).toBe(false);
    expect((await consume(key, 2, 60)).limited).toBe(false);

    const third = await consume(key, 2, 60);

    expect(third.limited).toBe(true);

    if (third.failure !== null) {
      const outcome = Match.value(third.failure.reason).pipe(
        Match.tag("RateLimitExceeded", (reason) => ({
          limited: true,
          retryAfterMs: Duration.toMillis(reason.retryAfter),
          limit: reason.limit,
        })),
        Match.orElse(() => ({ limited: false, retryAfterMs: 0, limit: 0 })),
      );

      expect(outcome.limited).toBe(true);
      expect(outcome.retryAfterMs).toBeGreaterThan(0);

      const mapping = troubleCodeFor("RateLimitExceeded");
      const headers = rateLimitHeaders(2, outcome.limit);

      expect(mapping.status).toBe(429);
      expect(headers.get("Retry-After")).toBe("2");
      expect(headers.get("RateLimit-Remaining")).toBe("0");
    }
  });

  test("quota is tracked per identity", async () => {
    const first = `test-a-${Date.now().toString(36)}`;
    const second = `test-b-${Date.now().toString(36)}`;

    expect((await consume(first, 1, 60)).limited).toBe(false);
    expect((await consume(first, 1, 60)).limited).toBe(true);
    expect((await consume(second, 1, 60)).limited).toBe(false);
  });
});
