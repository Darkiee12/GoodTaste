import { describe, expect, test } from "bun:test";

import { applyTestEnvDefaults, isDisposableTestDatabase } from "../bootstrap";

describe("test bootstrap guard", () => {
  test("accepts only the disposable loopback feastjourney database", () => {
    expect(
      isDisposableTestDatabase(
        "postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney",
      ),
    ).toBe(true);
    expect(isDisposableTestDatabase("postgres://u:pw@localhost:5432/feastjourney")).toBe(true);
    expect(isDisposableTestDatabase("postgres://u:pw@[::1]:5432/feastjourney")).toBe(true);
  });

  test("rejects production, shared, missing, and malformed targets", () => {
    expect(isDisposableTestDatabase(undefined)).toBe(false);
    expect(isDisposableTestDatabase("")).toBe(false);
    expect(isDisposableTestDatabase("not-a-url")).toBe(false);
    expect(isDisposableTestDatabase("postgres://u:pw@db.example.com:5432/feastjourney")).toBe(
      false,
    );
    expect(isDisposableTestDatabase("postgres://u:pw@127.0.0.1:5432/otherdb")).toBe(false);
    expect(isDisposableTestDatabase("postgres://u:pw@127.0.0.1:5432/feastjourney_extra")).toBe(
      false,
    );
  });

  test("fills only missing or empty entries, never overrides provided values", () => {
    const env = {
      SMTP_HOST: "",
      // SAFETY: test-only fixture — widens an absent value to the helper's
      // accepted input so the missing-key path is exercised.
      SMTP_PORT: undefined as string | undefined,
      GOOGLE_CLIENT_ID: "explicit-ci-secret",
    };

    applyTestEnvDefaults(env);

    expect(env.SMTP_HOST).toBe("localhost");
    expect(env.SMTP_PORT).toBe("1025");
    expect(env.GOOGLE_CLIENT_ID).toBe("explicit-ci-secret");
  });
});
