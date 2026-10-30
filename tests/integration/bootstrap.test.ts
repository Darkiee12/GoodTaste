import { describe, expect, test } from "bun:test";

// NOTE: this file intentionally imports the application auth module before
// anything else. `src/server/auth/better-auth.ts` validates the server
// environment at module-evaluation time, so if the test bootstrap
// (`tests/bootstrap.ts`, via `bunfig.toml` `[test] preload`) did not run
// first, this import throws and the file fails to load. Do not add a
// `cleanup` import above it: the point is to prove ordering independence.
import { auth } from "@/server/auth/better-auth";
import { serverEnv } from "@/server/env";

describe("test bootstrap ordering", () => {
  test("application modules evaluate with test environment ready", () => {
    expect(auth).toBeDefined();

    expect(serverEnv().SMTP_HOST).toBeTruthy();
    expect(serverEnv().EMAIL_FROM).toBeTruthy();
  });

  test("bootstrap never points at a non-disposable database", () => {
    expect(serverEnv().DATABASE_URL).toMatch(/127\.0\.0\.1|localhost/);
    expect(serverEnv().DATABASE_URL).toContain("/feastjourney");
  });
});
