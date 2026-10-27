# Effect v4 domain modeling (ADTs, actors, errors)

**Canonical scaffold rule.** FeastJourney uses **Effect's data-modeling primitives** in the backend, rather than hand-writing every discriminated union or Java-style DTO class. The project chooses **Zod 4.6** for external HTTP validation and **Reylo** for SQL typing; neither means the *internal application model* should ignore Effect. This guide is grounded in our vendored v4 source at `repos/effect/packages/effect/src/Data.ts`, `Schema.ts`, `Context.ts`, `Effect.ts`, and in `repos/effect/packages/effect/SCHEMA.md`.

## Pick the right primitive

| Need | Primitive | Why |
| --- | --- | --- |
| Internal ADT with variants, e.g. Guest/Member, discovery state, serving-evidence status | `Data.TaggedEnum` + `Data.taggedEnum` | Typed constructors and exhaustive `_tag` matching, without a second runtime decoder |
| ADT that must be **decoded/encoded** at a boundary | `Schema.TaggedUnion` | Tagged schema cases with parsing, encoding and matching |
| A single immutable domain value with behavior | `Data.Class` / `Data.TaggedClass` if useful | No requirement for a class for ordinary records |
| Expected, recoverable application failure | `Data.TaggedError` | A tagged error in Effect's failure channel; supports `Effect.catchTag` |
| Error that must also be decoded/encoded across a boundary | `Schema.TaggedError` | Tagged error plus a schema contract |
| Per-request trusted Actor shared by many nested operations | `Context.Service` + `Effect.provideService` **per HTTP request** | One verified actor, no global mutable identity |
| External incoming HTTP query/body/form | Zod 4.6 at TanStack boundary | Chosen transport validator; do not duplicate it in Effect Schema without a real need |
| Trusted PostgreSQL query result | Reylo-inferred SQL result | Source is migrated schema; do not invent parallel Zod/Effect row schemas |

Effect's `Data.TaggedEnum` and `Schema.TaggedUnion` are **different tools**: the former does *not* validate untrusted runtime values. The latter does runtime decoding and encoding. A simple `type` alias is fine for non-variant internal shapes; use tagged enums for business cases with actual alternatives, not every object.

## Canonical Actor ADT

Located conceptually at `src/server/auth/actor.ts` (the source file has not been created yet):

```ts
import { Data } from "effect";

export type Actor = Data.TaggedEnum<{
  Guest: {};
  Member: { readonly userId: string };
}>;

export const Actor = Data.taggedEnum<Actor>();

const guest = Actor.Guest();
const member = Actor.Member({ userId: "from-a-verified-session" });

export const describe = (actor: Actor) =>
  Actor.$match(actor, {
    Guest: () => "guest",
    Member: ({ userId }) => `member:${userId}`,
  });
```

`Guest()` produces `{ _tag: "Guest" }`; `Member(...)` produces `{ _tag: "Member", userId }`. `Actor.$match` enumerates both cases and is type-checked exhaustively; adding a third variant requires reviewing all matchers. **The code illustrates representation, not session verification.** The final UserId type/validation is a separate auth/data-model decision.

The `Guest` variant is **not** an anonymous User database record. Public Food Discovery and Restaurant Discovery accept guests, while member-owned operations require verified membership and resource ownership.

## Request-scoped service and Effect runtime

Located conceptually at `src/server/auth/current-actor.ts`:

```ts
import { Context, Effect } from "effect";
import { Actor } from "./actor";

export class CurrentActor extends Context.Service<
  CurrentActor,
  Actor
>()("feastjourney/auth/CurrentActor") {}

export const currentActorLabel = Effect.gen(function* () {
  const actor = yield* CurrentActor;
  return Actor.$match(actor, {
    Guest: () => "guest",
    Member: ({ userId }) => userId,
  });
});
```

This illustrates service ownership and requires the earlier `Actor` module; it is not itself an implemented session verifier.

In the trusted server-function/API adapter, resolve and verify the session, construct the `Actor` using its constructors, then supply that value around the operation **for this one invocation**:

```ts
// verifiedActor: Actor is produced by server-side session resolution.
const running = Effect.provideService(
  applicationOperation,
  CurrentActor,
  verifiedActor,
);

return appRuntime.runPromise(running);
```

The single process-wide `ManagedRuntime` may contain long-lived DB/provider layers, but it must not contain a specific user's identity. The Effect operation type visibly requires `CurrentActor` until the transport boundary provides it. For an operation with no nested consumers, passing `actor: Actor` explicitly instead of declaring a service is entirely valid.

## Typed domain failures

Illustrative typed auth failure (not a finalized error-response contract):

```ts
import { Data, Effect } from "effect";

class SignInRequired extends Data.TaggedError("SignInRequired")<{}> {}

const requireMember = Effect.gen(function* () {
  const actor = yield* CurrentActor;
  return yield* Actor.$match(actor, {
    Guest: () => Effect.fail(new SignInRequired()),
    Member: ({ userId }) => Effect.succeed(userId),
  });
});
```

`Effect.catchTag("SignInRequired", ...)` may handle that expected failure at the appropriate application boundary. Translate it to a client-safe HTTP/RPC response at TanStack's transport edge; never serialize raw database, Effect Cause or internal error stack to clients.

Avoid `throw new Error("unauthorized")`, magic `null`, magic numbers and inconsistent string status codes as the default representation for distinct domain outcomes. Do not force failures into an enum if a typed Effect failure channel is more appropriate.

## Where runtime validation belongs

- **HTTP:** Zod 4.6 parses externally supplied input. Do not allow clients to submit `{ _tag: "Member", userId: ... }` and treat it as authenticated identity.
- **Session verification:** auth adapter checks the cookie/token/server session, obtains a trusted user identifier, and constructs `Actor.Member(...)`, otherwise `Actor.Guest()`.
- **Database:** Reylo parses/query-types based on migrated PostgreSQL schema; runtime database constraints still matter.
- **Third-party AI/Places data:** validate and normalize untrusted responses at the adapter boundary using an appropriate decoder. `Schema.TaggedUnion` is an option if this boundary warrants Effect-native decoding. This is independent of the Zod HTTP choice.
- **Domain:** model valid state alternatives as tagged cases and handle every relevant alternative explicitly.

## Verification expectations

- Construct both actor cases and test exhaustive matching.
- A guest can use public discovery and cannot use member-only operations.
- A verified member can operate only on authorized resources; ownership checks remain independent of the actor tag.
- Check that request A's actor never appears in concurrent request B; no actor in singleton runtime configuration.
- Reject any attempt to gain `Member` privileges from client-provided fields.
- Test expected typed failures separately from defects and timeouts.

## Upstream references

- Vendored `repos/effect/packages/effect/src/Data.ts` (TaggedEnum, taggedEnum, TaggedError)
- Vendored `repos/effect/packages/effect/src/Schema.ts` (TaggedUnion, TaggedClass, TaggedError)
- Vendored `repos/effect/packages/effect/src/Context.ts` (Service)
- Vendored `repos/effect/packages/effect/src/Effect.ts` (provideService)
- https://effect.website/docs/v4/data-types/data
- https://effect.website/docs/v4/requirements-management/services
