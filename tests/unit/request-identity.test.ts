import { describe, expect, test } from "bun:test";

import type { AppConfig } from "@/server/config";
import { resolveIdentityFromHeaders } from "@/server/http/request";

const baseConfig: AppConfig = {
  databaseUrl: "postgres://localhost/test",
  databaseDirectUrl: undefined,
  poolMax: 1,
  corsOrigins: [],
  trustedProxies: [],
  publicRateLimit: 60,
  publicRateWindowSeconds: 60,
  searchRateLimit: 20,
  searchRateWindowSeconds: 60,
  adminRateLimit: 10,
  adminRateWindowSeconds: 60,
  requestTimeoutMs: 15000,
};

const configWithProxies: AppConfig = { ...baseConfig, trustedProxies: ["10.0.0.1"] };

describe("recommendation rate-limit identity", () => {
  test("uses the first forwarded address behind trusted proxies", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

    expect(resolveIdentityFromHeaders(headers, configWithProxies)).toBe("net:203.0.113.7");
  });

  test("ignores forwarded headers without trusted proxies", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });

    expect(resolveIdentityFromHeaders(headers, baseConfig)).toBe("net:direct");
  });

  test("falls back to direct when no forwarding header is present", () => {
    expect(resolveIdentityFromHeaders(new Headers(), configWithProxies)).toBe("net:direct");
  });

  test("two distinct clients stay isolated behind trusted proxies, share one budget otherwise", () => {
    const alice = new Headers({ "x-forwarded-for": "203.0.113.7" });
    const bob = new Headers({ "x-forwarded-for": "198.51.100.9" });

    // Supported deployment (trusted proxy strips/spoof-protects XFF):
    // distinct IPs get distinct identities, so one client's burst cannot
    // exhaust the other's quota.
    expect(resolveIdentityFromHeaders(alice, configWithProxies)).not.toBe(
      resolveIdentityFromHeaders(bob, configWithProxies),
    );

    // Direct deployment without trusted proxies: every client collapses to
    // the single honest global budget documented in recommendations.md.
    expect(resolveIdentityFromHeaders(alice, baseConfig)).toBe("net:direct");
    expect(resolveIdentityFromHeaders(bob, baseConfig)).toBe("net:direct");
  });
});
