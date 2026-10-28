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
});
