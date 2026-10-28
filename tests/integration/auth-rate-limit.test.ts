// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { createAuthPool } from "@/server/auth/database";
import { buildAuthOptions, createAuth } from "@/server/auth/options";
import type { ServerEnv } from "@/server/env";

const env: ServerEnv = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
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
  EMAIL_FROM: "test@example.com",
  TRUSTED_PROXIES: "",
};

/** Memory storage keeps this test independent of the shared rateLimit table. */
const limitedPool = createAuthPool(process.env.DATABASE_URL ?? "");

const limitedAuth = createAuth({
  ...buildAuthOptions(env, async () => {}, limitedPool, false),
  rateLimit: { enabled: true, window: 60, max: 2, storage: "memory", customRules: {} },
});

afterAll(async () => {
  await limitedPool.end();
});

const attempt = (): Promise<number> =>
  limitedAuth
    .handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ratelimit@example.com", password: "wrong" }),
      }),
    )
    .then((response) => response.status);

describe("authentication rate limiting", () => {
  test("eventually rejects rapid sign-ins with 429", async () => {
    const statuses = await Promise.all([
      attempt(),
      attempt(),
      attempt(),
      attempt(),
      attempt(),
      attempt(),
    ]);

    expect(statuses).toContain(429);
  });
});
