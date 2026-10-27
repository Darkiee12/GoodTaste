# Guest and authenticated-member boundaries

Authentication (who are you?) and authorization (what may you do?) are different. **Do not duplicate the Food Discovery or Restaurant Discovery modules into guest and member variants.** Public read operations serve both actors; member-only actions additionally require a verified session.

A request-scoped actor is an **Effect v4 algebraic data type**, not a hand-maintained transport DTO. Its conceptual implementation is:

```ts
// src/server/auth/actor.ts (illustrative; this source file does not yet exist)
import { Data } from "effect";

export type Actor = Data.TaggedEnum<{
  Guest: {};
  Member: { readonly userId: string };
}>;

export const Actor = Data.taggedEnum<Actor>();

const guest = Actor.Guest();
const member = Actor.Member({ userId: "trusted-session-id" });

const label = Actor.$match(member, {
  Guest: () => "guest",
  Member: ({ userId }) => `member:${userId}`,
});
```

`Guest()` and `Member(...)` construct the two variants and add Effect's conventional `_tag`. The `$match` handlers are exhaustive over `Guest` and `Member`. The `string` used for `userId` here is intentionally illustrative: choose and validate the real user ID contract at the session/database boundary.

This is **not input validation**. Never construct `Actor.Member` from a browser-supplied user ID, role, cookie content, or unverified JWT. Resolve and verify the session **on the server** first; only trusted identity resolution is permitted to construct `Member`. A guest has no automatic persistent User record.

## Actor as a request-scoped Effect requirement

For operations spanning modules, depend on an explicit `CurrentActor` service **provided per invocation**, not mutable state inside the process-scoped `ManagedRuntime`:

```ts
// src/server/auth/current-actor.ts (illustrative)
import { Context, Effect } from "effect";
import type { Actor } from "./actor";

export class CurrentActor
  extends Context.Service<CurrentActor, Actor>()(
    "feastjourney/auth/CurrentActor",
  ) {}

export const describeActor = Effect.gen(function* () {
  const actor = yield* CurrentActor;
  return actor._tag === "Guest" ? "guest" : actor.userId;
});

// After verifying the session at the server boundary:
declare const verifiedActor: Actor; // illustration only; never client input
declare const appRuntime: {
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
};

const result = await appRuntime.runPromise(
  Effect.provideService(describeActor, CurrentActor, verifiedActor),
);
```

The `declare` values are **illustrative types**, not runtime authorization; no input can be considered `verifiedActor` until the session has been checked server-side. Actual TanStack server handlers must resolve the trusted `Actor` and supply it before executing the Effect. A process-scoped database/AI `Layer` may remain shared, but `CurrentActor` is required and provided **once per request**. Use a single `Context.Service` for identity when nested operations need it; if only one function needs the actor, an explicit `Actor` parameter is simpler.

Domain permissions, such as owner-only writes, can use `Actor.$match(actor, { Guest: ..., Member: ... })` to make policy decisions explicit. Treat an authenticated member with insufficient privileges as a distinct authorization failure; "member" does not imply admin.

**Do not replace this ADT with a plain `{kind: string}` object or create a second Zod schema for it**. See [Effect domain modeling](domain-modeling.md) for when `Data.TaggedEnum`, `Schema.TaggedUnion`, and `Data.TaggedError` are appropriate.

## Initial access matrix

| Capability | Guest | Member |
| --- | --- | --- |
| Discover foods/cuisines and read public dish information | Allowed | Allowed |
| Search restaurants and inspect public serving evidence | Allowed | Allowed |
| Browse public menu descriptions and translations | Allowed | Allowed |
| Save favorites, preferences, private lists or history | Sign-in required | Own data only |
| Read/change profile or another member-owned object | Denied | Own data only |
| Expensive image-menu analysis and durable photo uploads | **Policy to decide** | **Policy to decide** |
| Submit public corrections/contributions | **Policy to decide** | **Policy to decide** |
| Moderation/admin actions | Denied | Only with explicit authorization |

The undecided rows are not implied permissions. Product, cost, privacy and anti-abuse decisions must be recorded before implementing them. Guests can hold ephemeral local choices without silently creating server accounts or persisting photos.

## Enforcement

1. Route redirects/hidden UI are **UX only**. TanStack `createServerFn` and raw API handlers are directly callable and each independently verifies the current actor and required capability.
2. Shared session verification and common policy helpers live in `src/server/auth/`. Resource ownership checks are executed at the sensitive operation boundary, not assumed from the page.
3. A session is validated server-side; never authorize private resources using client-provided `userId` or a route `beforeLoad` alone.
4. Member-owned result caching must be private; never expose one user's preferences/history to another user or a public cache.
5. Cross-module workflows read the trusted `Actor` as an explicit argument or `CurrentActor` Context requirement provided by the HTTP adapter with `Effect.provideService`. Never install an actor as a shared `ManagedRuntime` layer. Authorization remains enforced for every private capability.
6. Configure safe cookies, CSRF protections and rate/abuse limits appropriate to each endpoint. If adding a custom `src/start.ts`, explicitly preserve TanStack's needed CSRF middleware behavior.
7. HTTP queries, params, and forms use **Zod 4.6**. Reylo types database reads; AI responses/external APIs still require runtime validation at their trust boundaries.

References: https://tanstack.com/start/latest/docs/framework/react/guide/authentication · https://tanstack.com/start/latest/docs/framework/react/guide/middleware
