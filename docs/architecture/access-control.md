# Guest and authenticated-member boundaries

Authentication (who are you?) and authorization (what may you do?) are different. **Do not duplicate the Food Discovery or Restaurant Discovery modules into guest and member variants.** Public read operations serve both actors; member-only actions additionally require a verified session.

A request-scoped actor has this conceptual shape:

```ts
type Actor =
  | { readonly kind: "guest" }
  | { readonly kind: "member"; readonly userId: string };
```

This is an illustrative type, not an instruction to trust user IDs from the browser. The actor is derived from a verified server session. A guest has no automatic persistent User record. Never put actor state in a mutable global variable or singleton Effect service.

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
5. Cross-module workflows propagate request-scoped identity (explicit argument or scoped Effect context); authorization remains enforced for every private capability.
6. Configure safe cookies, CSRF protections and rate/abuse limits appropriate to each endpoint. If adding a custom `src/start.ts`, explicitly preserve TanStack's needed CSRF middleware behavior.
7. HTTP queries, params, and forms use **Zod 4.6**. Reylo types database reads; AI responses/external APIs still require runtime validation at their trust boundaries.

References: https://tanstack.com/start/latest/docs/framework/react/guide/authentication · https://tanstack.com/start/latest/docs/framework/react/guide/middleware
