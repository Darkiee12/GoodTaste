import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Predicate } from "effect";

import {
  RestaurantInputError,
  RestaurantNotFound,
  FxUnavailable,
} from "@/modules/restaurant-discovery/server/index";
import { appConfig } from "@/server/config";
import { RateLimitPolicy, type RateLimitBucket } from "@/server/http/rate-limit";
import { resolveClientIdentity } from "@/server/http/request";
import type { AppServices } from "@/server/layers";
import { appRuntime, withRequestTimeout } from "@/server/runtime";

/** Resolve typed failures before FiberFailure wrapping; never send raw database errors to the browser. */
export async function runClientOperation<A, E, R extends AppServices>(
  effect: Effect.Effect<A, E, R>,
  bucket: RateLimitBucket | null = "public",
): Promise<A> {
  const guarded = Effect.gen(function* () {
    if (bucket !== null) {
      const config = yield* appConfig;
      const policy = yield* RateLimitPolicy;

      const identity = resolveClientIdentity(
        new Request("http://server-function", { headers: getRequestHeaders() }),
        config,
      );

      yield* policy.check(bucket, identity);
    }

    return yield* effect;
  });

  const result = await appRuntime.runPromise(
    withRequestTimeout(guarded, "restaurant/rpc", 15000).pipe(
      Effect.tapError((error) => Effect.logWarning("Restaurant request failed", { error })),
      Effect.mapError((error) => {
        if (error instanceof RestaurantInputError || error instanceof FxUnavailable)
          return error.reason;

        if (error instanceof RestaurantNotFound) return "This restaurant is unavailable.";

        if (Predicate.hasProperty(error, "_tag")) {
          if (Predicate.isTagged(error, "RateLimitExceeded"))
            return "Too many requests. Please wait before retrying.";

          if (Predicate.isTagged(error, "SignInRequired")) return "Sign in to manage restaurants.";

          if (Predicate.isTagged(error, "InsufficientPermissions"))
            return "You do not have permission for this action.";

          if (Predicate.isTagged(error, "PersistenceConflict"))
            return "This source or record already exists. Reuse the existing offering IDs for a new observation.";

          if (Predicate.isTagged(error, "DishNotFound")) return "Choose a published dish.";
        }

        return "Restaurant data is temporarily unavailable. Please retry.";
      }),
      Effect.result,
    ),
  );

  // Result is Effect's ADT; only its client-safe failure string leaves the server.
  const { Result } = await import("effect");

  return Result.match(result, {
    onSuccess: (value) => value,
    onFailure: (message) => {
      throw new Error(message);
    },
  });
}
