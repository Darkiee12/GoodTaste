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

- Protected roles (`owner`) require `role:manage-protected` to touch, and the last owner assignment cannot be removed (`LastOwnerRemovalDenied`).
- System roles cannot be deleted, only unassigned.
- Nobody grants what they do not hold: attaching a permission requires holding it yourself (`requireDelegatable`), and assigning a role requires `role:assign` plus the target being manageable.
- The bootstrap script creates the first owner out of band; there is no public path to ownership.

## Better Auth's place in the picture

Better Auth owns **authentication only**: sessions, passwords, OAuth, verification, recovery. Its admin plugin is deliberately neutralized — every role in its access-control config carries **zero grants**, so `/api/auth/admin/*` denies for everyone. All user administration (list, ban, roles, session revocation) is implemented behind our authorization boundary with Reylo queries; the plugin's passive behavior (default role on signup, banned-user session blocking) remains.

This avoids two competing authorization systems: the plugin can never grant what dynamic RBAC denies, and dynamic RBAC never consults the plugin's static checks. `user.role` is kept as a display hint only and is **not** consulted for authorization.

## Effect integration

- `Actor` is a `Data.TaggedEnum` (`Guest` | `Member` | `Admin`); construction happens only from verified sessions (members) or the admin-key path (admin). Pattern-match with `$match`, never by reading `_tag`.
- `Authorization` is a `Context.Service` resolved per request; checks return typed failures (`InsufficientPermissions`, `ProtectedRole`, `RoleNotManageable`, `UnknownPermission`, `LastOwnerRemovalDenied`, ...), mapped to HTTP statuses in `api-error.ts`.
- Branded `UserId`/`RoleId` (`Brand.nominal` + Zod parsing at the boundary) make swapped identifiers a compile error.

## Future work

Catalog curation still uses the admin key while its operations migrate to `food:*` role grants (the permissions already exist). API access/refresh tokens, if ever needed, must go through Better Auth's OAuth 2.1 provider capabilities — never a homemade JWT layer.
