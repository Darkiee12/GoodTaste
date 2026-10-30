import { Context, Effect } from "effect";

import type { Actor } from "@/server/auth/actor";
import { Actor as ActorConstructors } from "@/server/auth/actor";

export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "feastjourney/auth/CurrentActor",
) {}

export const currentActorLabel = Effect.gen(function* () {
  const actor = yield* CurrentActor;

  return ActorConstructors.$match(actor, {
    Guest: () => "guest",
    Member: ({ userId }) => `member:${userId}`,
  });
});

export const withActor = <A, E, R>(
  actor: Actor,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, CurrentActor>> =>
  Effect.provideService(effect, CurrentActor, actor);
