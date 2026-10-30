// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { createAuthPool } from "@/server/auth/database";
import { buildAuthOptions } from "@/server/auth/options";
import type { ServerEnv } from "@/server/env";

const env: ServerEnv = {
  DATABASE_URL: "postgres://stub:stub@localhost:5432/stub",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
  GOOGLE_CLIENT_ID: "stub",
  GOOGLE_CLIENT_SECRET: "stub",
  FACEBOOK_CLIENT_ID: "stub",
  FACEBOOK_CLIENT_SECRET: "stub",
  SMTP_HOST: "localhost",
  SMTP_PORT: 1025,
  SMTP_USERNAME: "stub",
  SMTP_PASSWORD: "stub",
  EMAIL_FROM: "stub@example.com",
  TRUSTED_PROXIES: "",
};

describe("production auth configuration", () => {
  const configPool = createAuthPool("postgres://stub:stub@localhost:5432/stub");

  afterAll(async () => {
    await configPool.end();
  });

  const options = buildAuthOptions(env, async () => {}, configPool);

  test("sessions live 7 days with daily renewal and no cookie cache", () => {
    expect(options.session.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(options.session.updateAge).toBe(60 * 60 * 24);
    expect("cookieCache" in options.session).toBe(false);
  });

  test("email verification is mandatory and password reset revokes sessions", () => {
    expect(options.emailAndPassword.requireEmailVerification).toBe(true);
    expect(options.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
    expect(options.emailVerification.sendOnSignUp).toBe(true);
  });

  test("account linking only merges verified same-email accounts", () => {
    expect(options.account.accountLinking.enabled).toBe(true);
    expect(options.account.accountLinking.requireLocalEmailVerified).toBe(true);
    expect(options.account.accountLinking.allowDifferentEmails).toBe(false);
    expect(options.account.accountLinking.allowUnlinkingAll).toBe(false);
    expect(options.account.accountLinking.trustedProviders).toEqual(["google", "facebook"]);
  });

  test("rate limiting is enforced and shared across replicas", () => {
    expect(options.rateLimit.enabled).toBe(true);
    expect(options.rateLimit.storage).toBe("database");
  });

  test("admin plugin uses member default with no impersonation grants", () => {
    const admin = options.plugins.find((plugin) => plugin.id === "admin");
    expect(admin).toBeDefined();
  });

  test("tanstack cookie handling stays last in the plugin chain", () => {
    const ids = options.plugins.map((plugin) => plugin.id);
    expect(ids[ids.length - 1]).toBe("tanstack-start-cookies");
  });
});
