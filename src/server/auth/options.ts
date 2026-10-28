import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { authDb } from "@/server/auth/kysely";
import { pluginAccessControl, pluginRoles } from "@/server/auth/permissions";
import type { OutboundEmail } from "@/server/email";
import type { ServerEnv } from "@/server/env";

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
  frameworkCookies = true,
) => ({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: {
    db: authDb,
    type: "postgres" as const,
    schemaName: "feastjourney",
    transaction: true,
  },
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
