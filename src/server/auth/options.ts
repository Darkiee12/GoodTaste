import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Effect } from "effect";
import type { Pool } from "pg";
import { z } from "zod";

import { pluginAccessControl, pluginRoles } from "@/server/auth/permissions";
import type { OutboundEmail } from "@/server/email";
import type { ServerEnv } from "@/server/env";

const ownerBootstrapUserSchema = z.object({
  email: z.string().min(1),
  id: z.string().min(1),
});

type OwnerBootstrapUser = z.infer<typeof ownerBootstrapUserSchema>;

const bootstrapFailure = (step: string): Error => new Error(`owner-email bootstrap: ${step}`);

/**
 * Owner bootstrap from the environment. When OWNER_EMAIL names an address,
 * the account holding it receives the owner role right after creation
 * (email and OAuth signups alike — Better Auth fires user.create for every
 * creation path). Idempotent: existing owners are left untouched, failures
 * are logged by the caller and never break signup, and without the variable
 * nothing happens — the first signup stays a plain member. This is the only
 * privileged grant outside the role-management operations, and every grant
 * is recorded in the security audit log.
 */
function grantOwnerEffect(pool: Pool, ownerEmail: string | undefined, user: OwnerBootstrapUser) {
  return Effect.gen(function* () {
    if (ownerEmail === undefined) {
      return;
    }

    if (user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
      return;
    }

    const client = yield* Effect.acquireRelease(
      Effect.tryPromise({
        catch: () => bootstrapFailure("pool connect failed"),
        try: () => pool.connect(),
      }),
      (released) => Effect.sync(() => released.release()),
    );

    const existing = yield* Effect.tryPromise({
      catch: () => bootstrapFailure("membership check failed"),
      try: () =>
        client.query(
          "SELECT 1 FROM feastjourney.user_roles WHERE user_id = $1 AND role_id = 'owner'",
          [user.id],
        ),
    });

    if ((existing.rowCount ?? 0) > 0) {
      return;
    }

    yield* Effect.tryPromise({
      catch: () => bootstrapFailure("grant insert failed"),
      try: () =>
        client.query(
          "INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES ($1, 'owner') ON CONFLICT DO NOTHING",
          [user.id],
        ),
    });

    yield* Effect.tryPromise({
      catch: () => bootstrapFailure("audit insert failed"),
      try: () =>
        client.query(
          `INSERT INTO feastjourney.security_audit_events
            (actor_user_id, session_id, request_id, event, outcome, reason, resource, metadata)
          VALUES (NULL, NULL, $1, 'auth.role.assigned', 'succeeded', 'owner-email bootstrap', 'owner', $2)`,
          [crypto.randomUUID(), JSON.stringify({ via: "owner-email-env" })],
        ),
    });
  });
}

/**
 * Better Auth configuration factory. Pure enough for the migration-codegen
 * script to import with stub environment; the production singleton lives in
 * `better-auth.ts`.
 *
 * Session model: database-backed opaque cookie sessions, 7-day lifetime with
 * daily sliding renewal, no cookie cache (revocation is immediate), 15-minute
 * freshness window for Better Auth's own sensitive endpoints.
 */
export const buildAuthOptions = (
  env: ServerEnv,
  send: (email: OutboundEmail) => Promise<void>,
  database: Pool,
  frameworkCookies = true,
) => ({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      await send({
        to: user.email,
        subject: "Reset your FeastJourney password",
        text: `Reset your password with this link (expires in 1 hour):\n\n${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
      await send({
        to: user.email,
        subject: "Verify your FeastJourney email",
        text: `Verify your email address with this link (expires in 1 hour):\n\n${url}`,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    facebook: {
      clientId: env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      requireLocalEmailVerified: true,
      trustedProviders: ["google", "facebook"],
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  databaseHooks: {
    user: {
      create: {
        after: (rawUser: OwnerBootstrapUser) =>
          Effect.runPromise(
            Effect.scoped(grantOwnerEffect(database, env.OWNER_EMAIL, rawUser)).pipe(
              Effect.tapError((error) =>
                Effect.logError(`[auth] owner-email bootstrap failed: ${error.message}`),
              ),
              Effect.ignore,
            ),
          ),
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database" as const,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 300, max: 10 },
      "/forget-password": { window: 300, max: 5 },
      "/verify-email": { window: 300, max: 10 },
      "/callback/:id": { window: 60, max: 30 },
    },
  },
  plugins: [
    admin({
      defaultRole: "member",
      adminRoles: ["admin"],
      ac: pluginAccessControl,
      roles: pluginRoles,
    }),
    ...(frameworkCookies ? [tanstackStartCookies()] : []),
  ],
  trustedOrigins: [env.BETTER_AUTH_URL],
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      trustedProxies: env.TRUSTED_PROXIES.split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    },
  },
});

export const createAuth = <const Options extends BetterAuthOptions>(options: Options) =>
  betterAuth(options);
