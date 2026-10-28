# Dynamic RBAC authorization

Authentication (who are you?) and authorization (what may you do?) are different. **Do not duplicate the Food Discovery or Restaurant Discovery modules into guest and member variants.** Public read operations serve both actors; member-only actions additionally require a verified session.

## Three enforcement stages

Every protected operation passes three gates, in order:

1. **Authentication** — a valid, non-suspended server session (`requireAuthenticatedActor`). No session → 401. Banned users fail here, before any authorization logic runs.
2. **Authorization** — the actor's effective permissions cover the request (`requirePermission`). Effective grants are the union of all permissions attached to the user's roles, read fresh from PostgreSQL on every call. Anything not granted is denied; guests and service actors hold nothing. Failures → 403, never success defaults.
3. **Ownership and domain policy** — resource-level checks (`checkOwnership`, dish existence, unlink-last-method guard). A permission answers whether the actor *may* act; ownership answers whether they may act *on this resource*.

Rate limiting and request identity run before all three (abuse protection first).

## Database-managed roles (no static role grants)

Roles, grants, and assignments live in PostgreSQL (`roles`, `permissions`, `role_permissions`, `user_roles`; migrations `V006`/`V007`):

- The **permission vocabulary** is static code (`src/server/auth/permissions.ts`): `resource:action` strings such as `food:publish` or `role:assign`. Unknown keys are rejected at the management boundary, so no client can invent a grant.
- **Roles** are rows with slug, description, color, position, and system/protected flags. Administrators create custom roles without redeploying.
- A user may hold **multiple roles**; effective permissions are the union of their grants. Position is display/hierarchy order only — it never confers permissions.
- Grants are resolved per request (one indexed query); there is no permission cache to invalidate. Role edits, assignments, and revocations apply to the next operation, including on already-issued sessions.

## System roles and the owner

Seeded roles: `member`, `curator`, `moderator`, `support`, `admin` (system, editable metadata only) and `owner` (protected). Rules:

- Protected roles (`owner`) require `role:manage-protected` to touch, and the last active owner cannot be removed or banned (`LastOwnerRemovalDenied`).
- An active owner holds the `owner` role and is not banned. Owner-membership changes serialize on a guard row (`SELECT ... FOR UPDATE` on the owner role) with the count and the mutation in one transaction, so concurrent removals cannot strand the system without an owner. Unrelated role changes take no lock.
- Banning any owner requires `role:manage-protected`, and revoking an owner's sessions does too. Ordinary administrators hold neither path to a protected account.
- System roles cannot be deleted, only unassigned.
- Nobody grants what they do not hold: attaching a permission requires holding it yourself (`requireDelegatable`), and assigning a role requires `role:assign` plus the target being manageable.
- Every new account receives `member` automatically via a database trigger in the user-insert transaction (migration `V009`); no second write, no hook race.
- The bootstrap script creates the first owner out of band; there is no public path to ownership.

## Catalog administration authorization

All catalog administration endpoints resolve the actor from the verified Better Auth session and enforce per-operation database grants (`src/modules/food-discovery/server/api-adapter.ts`, `withAuthorized`). There is no API-key path and no machine identity: every administrative request is a human session or it is rejected.

| Operation | Required permission |
| --- | --- |
| Create draft dish | `food:create` (+ `food:publish` when the request publishes immediately) |
| Update dish metadata | `food:update` (+ `food:publish` when `status` changes) |
| Status-only transitions | `food:publish` |
| Names, descriptions, ingredient/place/category/cuisine links, notes | `food:update` |
| Review queue | `moderation:read` |
| Import validate / apply | `food:import` (explicit bulk-write grant; seeded to curator, admin, owner) |

`admin:access` guards the administration surface only; it never authorizes a resource mutation by itself.

Restaurant workspace access requires `restaurant:manage`; review controls
additionally require `restaurant:review`. These grants are seeded to curator,
admin and owner by `V20261028_100` and remain dynamically assignable. The admin
surface OR-gate recognizes restaurant managers. Every venue/menu/import and
visibility operation checks `manage` internally; every price/serving approval or
rejection checks `review` internally. Mutations and mandatory audit events share
a transaction. Public discovery needs neither grant nor a session.

## Better Auth's place in the picture

Better Auth owns **authentication only**: sessions, passwords, OAuth, verification, recovery. Its admin plugin is deliberately neutralized — every role in its access-control config carries **zero grants**, so `/api/auth/admin/*` denies for everyone. All user administration (list, ban, roles, session revocation) is implemented behind our authorization boundary with Reylo queries; the plugin's passive behavior (default role on signup, banned-user session blocking) remains.

This avoids two competing authorization systems: the plugin can never grant what dynamic RBAC denies, and dynamic RBAC never consults the plugin's static checks. `user.role` is kept as a display hint only and is **not** consulted for authorization.

## Effect integration

- `Actor` is a `Data.TaggedEnum` (`Guest` | `Member`); human actors are constructed only from verified sessions (members). Guests are the public-read actor. Pattern-match with `$match`, never by reading `_tag`.
- `Authorization` is a `Context.Service` resolved per request; checks return typed failures (`InsufficientPermissions`, `ProtectedRole`, `RoleNotManageable`, `UnknownPermission`, `LastOwnerRemovalDenied`, ...), mapped to HTTP statuses in `api-error.ts`. `requireManageableRole` answers only whether the target may be touched; every operation enforces its own permission (`role:create/read/update/delete/assign/manage-permissions`) independently at its boundary.
- Branded `UserId`/`RoleId`/`SessionId` (`Brand.nominal` + Zod parsing at the boundary) make swapped identifiers a compile error.

## Audit atomicity

Privileged mutations (role create/update/delete, grant replacement, assignments, ban/unban, session revocation) write their mandatory audit record in the same PostgreSQL transaction as the mutation: an audit-insert failure rolls the mutation back. Best-effort event audit (profile edits, favorites, provider-owned session flows) is recorded after the decision and never gates access. See `src/modules/user/server/operations/audit.ts` for the category contract.

## Future work

API access/refresh tokens, if ever needed, must go through Better Auth's OAuth 2.1 provider capabilities — never a homemade JWT layer. There is no machine-identity model today: no service clients, no shared secrets, no credential rotation to document.
