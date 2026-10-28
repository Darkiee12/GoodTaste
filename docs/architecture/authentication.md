# Authentication and session security

**Status: Implemented.** See `access-control.md` for the authoritative dynamic
RBAC design (this document retains the session/token lifecycle reference;
role details moved there when static grants were replaced).

FeastJourney uses **Better Auth with database-backed opaque cookie sessions**
for its first-party site. There is no homemade password hashing, no custom
JWT issuance, and no second auth server. Effect's `Actor` ADT
(`src/server/auth/actor.ts`) is constructed only from a verified server
session; `CurrentActor` is provided per request, never stored globally.

## Session model

- Lifetime 7 days (`expiresIn: 604800`), sliding renewal daily
  (`updateAge: 86400`). Cookie `HttpOnly`, `Secure` in production,
  SameSite `lax` (Better Auth defaults).
- No cookie cache: every `getSession` reads the session row plus the user row
  fresh from PostgreSQL. Revocation is immediate, and role/ban changes apply
  to the next protected operation without waiting for expiry.
- Freshness window 15 minutes (`freshAge: 900`): Better Auth's own sensitive
  endpoints and our `requireRecentAuthentication` guard force a fresh sign-in
  for role changes, bans, and unlinking the last method.
- Password reset revokes all of the user's sessions
  (`revokeSessionsOnPasswordReset: true`).

## Token categories (kept separate)

- **Browser session token**: opaque, in a secure cookie, resolved server-side
  against the `session` table. Never a permission carrier.
- **Google/Facebook provider tokens**: belong to the identity provider, stored
  in the `account` table by Better Auth for its own refresh handling. Never
  returned to application responses, never treated as FeastJourney
  authorization.
- **No FeastJourney API access/refresh tokens are issued.** The web app needs
  none. If mobile/third-party clients arrive, prefer Better Auth's OAuth 2.1
  provider capabilities; the required properties (short-lived access,
  rotating refresh with reuse detection, server-side revocation state) are
  documented as a future contract, not implemented.

## Sign-in methods

Email/password (bcrypt-equivalent hashing inside Better Auth, never in app
code), Google OAuth, Facebook Login. Minimum scopes; no offline access
requested. Account linking requires a verified local email, same-email
matching only (`allowDifferentEmails: false`), trusted providers
`["google", "facebook"]`, and unlinking the last method is refused
(`allowUnlinkingAll: false` plus a server-side `UnlinkDenied` guard).

Email verification is mandatory (`requireEmailVerification`); sign-in before
verification fails. Verification and reset links expire in 1 hour.

## Authorization (dynamic RBAC)

Roles and grants live in PostgreSQL; the permission vocabulary is static code
(`src/server/auth/permissions.ts`). Guards:

- `requireAuthenticatedActor` — verified session, not banned.
- `requirePermission` — effective database grants cover the request, fails
  `InsufficientPermissions`.
- `checkOwnership` — resource owner check, fails `OwnershipDenied`.
- `requireRecentAuthentication` — session younger than 15 minutes.

Ownership is enforced per operation (favorites/profile scoped by session
user ID). Banning blocks guarded operations via `UserSuspended` and revokes
all sessions immediately. Role changes take effect on the next operation
(grants are read fresh every time; nothing is cached in the session).

Impersonation is not granted to any role: the `impersonate` actions are
absent from the admin plugin's access-control config, so
`/api/auth/admin/*` denies for everyone including administrators. All user
administration runs behind dynamic RBAC instead.

## Rate limiting and audit

Better Auth's built-in limiter with **database** storage (`rateLimit` table),
so limits hold across replicas: sign-in 10/min, sign-up 10/5min, reset 5/5min,
verification resend 10/5min, OAuth callbacks 30/min, 100/min default.

Security audit events (`auth.sign_in.*`, `auth.password.*`,
`auth.session.revoked*`, `auth.role.changed`, `auth.permission.denied`, ...)
append to `security_audit_events`. Never logged: cookies, passwords, OAuth or
API tokens, reset tokens, client secrets. Audit writes run after the
authorization decision they record, so an audit failure cannot turn a denial
into an allowance.

## Environment and operations

Validated once at startup by `src/server/env.ts` (Zod, server-only). All
providers and SMTP are mandatory; startup fails loudly instead of silently
disabling them. See `.env.example` for names. Google/Facebook callback URLs:

- `<BETTER_AUTH_URL>/api/auth/callback/google`
- `<BETTER_AUTH_URL>/api/auth/callback/facebook`

Local email: point SMTP at Mailpit. First admin: `bun scripts/create-admin.ts
<email> <password>` (shell + DB access required; not reachable over HTTP).
Tests use stub OAuth credentials and an in-memory mail sender; no real
secrets are committed.

## What is intentionally not built

- TOTP two-factor: the step-up mechanism is session freshness (15 min) for
  privileged operations. TOTP remains a documented follow-up.
- API access/refresh tokens and their rotation/reuse machinery: no issuance
  path exists, so refresh-reuse tests are not applicable to the browser
  session model.
