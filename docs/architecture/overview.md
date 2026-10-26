# GoodTaste architecture

**Decision:** Single-deployment TanStack Start + Effect v4 modular monolith, not multiple applications or workspace packages. TanStack owns requests and rendering; Effect runs backend operations and provides dependencies; Reylo types PostgreSQL SQL imports.

Three foundational modules:

- **User (`user`)**: accounts, verified identities, member preferences and member-owned records. A guest is an *actor*, not an automatically created User row.
- **Food Discovery (`food-discovery`)**: dish identity, cuisines, ingredients, food discovery and explanations. Answers **what to eat?**
- **Restaurant Discovery (`restaurant-discovery`)**: restaurants, locations, menu evidence and associations between places and food. Answers **where can I eat it?**

Do not confuse a dish with a venue's offering. An inferred dish-to-venue match is not proof it is served, nor is AI ingredient interpretation an allergy safety guarantee. All claims about availability/ingredients require provenance and explicit uncertainty.

## Request flow

TanStack route or module server function / external API → Zod 4.6 validation of HTTP input → verified guest/member actor and authorization → Effect application operation → domain module or cross-domain workflow → Effect-provided Reylo/Postgres/AI/Places/storage adapters.

- Browser components never import server-only code. Server functions may be imported statically as TanStack's transformed RPC stubs.
- Public discovery is available to both guests and members; user-owned operations require sign-in and ownership validation. Represent request principals as a trusted `Data.TaggedEnum` Actor and supply `CurrentActor` per Effect invocation, not in the singleton runtime.
- Use a process-scoped ManagedRuntime for shared connections, but **never** store the current user in that singleton.
- SQL results are typed by Reylo and constrained by PostgreSQL; do not wrap every trusted row in duplicate Zod schemas. Still validate AI/external-provider output.
- Any direct inter-module dependency must use a public server contract, remain acyclic and not bypass authorization.
- Avoid a new domain for translations, ordering, or menu scanning until separate ownership is demonstrated. These begin as operations or cross-domain workflows.

Read [module layout](modules.md), [access control](access-control.md), [contracts](contracts.md), [Effect conventions](effect.md), and [data ownership](data-model.md).

References: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions · https://tanstack.com/start/latest/docs/framework/react/guide/middleware · https://effect.website/docs/v4/runtime · https://reylo.dev/#sql
