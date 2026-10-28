import { afterEach, describe, expect, test } from "bun:test";

import { resetServerEnvCache, serverEnv } from "@/server/env";

const valid = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/db",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "at-least-32-characters-long-secret",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  FACEBOOK_CLIENT_ID: "facebook-id",
  FACEBOOK_CLIENT_SECRET: "facebook-secret",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_USERNAME: "user",
  SMTP_PASSWORD: "pw",
  EMAIL_FROM: "test@example.com",
  TRUSTED_PROXIES: "",
};

const snapshot = { ...process.env };

const withEnv = (overrides: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(valid)) {
    process.env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  resetServerEnvCache();
};

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    process.env[key] = value;
  }

  resetServerEnvCache();
});

describe("server environment", () => {
  test("accepts a complete valid environment", () => {
    withEnv({});
    expect(serverEnv().DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  test("fails fast when a provider credential is missing", () => {
    withEnv({ GOOGLE_CLIENT_ID: undefined });
    expect(() => serverEnv()).toThrow(/GOOGLE_CLIENT_ID/);
  });

  test("fails fast when email delivery is unconfigured", () => {
    withEnv({ SMTP_HOST: undefined });
    expect(() => serverEnv()).toThrow(/SMTP_HOST/);
  });

  test("rejects short secrets without revealing them", () => {
    withEnv({ BETTER_AUTH_SECRET: "too-short" });

    try {
      serverEnv();
      expect.unreachable("expected validation to fail");
    } catch (error) {
      expect(String(error)).toContain("BETTER_AUTH_SECRET");
      expect(String(error)).not.toContain("too-short");
    }
  });

  test("rejects invalid base URLs", () => {
    withEnv({ BETTER_AUTH_URL: "not-a-url" });
    expect(() => serverEnv()).toThrow(/BETTER_AUTH_URL/);
  });
});
