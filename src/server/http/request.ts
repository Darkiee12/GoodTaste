import { timingSafeEqual } from "node:crypto";

import type { Actor } from "@/server/auth/actor";
import { Actor as ActorConstructors } from "@/server/auth/actor";
import type { AppConfig } from "@/server/config";
import { apiErrorBody, troubleCodeFor } from "@/server/http/api-error";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const requestIdFromHeaders = (headers: Headers): string => {
  const received = headers.get("x-request-id");

  if (received !== null && REQUEST_ID_PATTERN.test(received)) {
    return received;
  }

  return crypto.randomUUID();
};

const hashIdentity = (value: string): string => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }

  return `h${(hash >>> 0).toString(16)}`;
};

const adminKeyMatches = (received: string | null, expected: string | undefined): boolean => {
  if (received === null || expected === undefined || expected.length === 0) {
    return false;
  }

  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  if (receivedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(receivedBytes, expectedBytes);
};

export const resolveAdmin = (request: Request, config: AppConfig): boolean =>
  adminKeyMatches(request.headers.get("x-admin-key"), config.adminApiKey);

/**
 * Stable per-client identity for rate-limit buckets. Authenticated admins are
 * keyed by a hash of their credential; behind a configured trusted proxy the
 * first X-Forwarded-For entry is used; otherwise the header is ignored so
 * arbitrary callers cannot spoof another client's quota.
 */
export const resolveClientIdentity = (request: Request, config: AppConfig): string => {
  const adminKey = request.headers.get("x-admin-key");

  if (adminKeyMatches(adminKey, config.adminApiKey)) {
    return `admin:${hashIdentity(adminKey ?? "")}`;
  }

  if (config.trustedProxies.length > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim() ?? "";

    if (first.length > 0) {
      return `net:${first}`;
    }
  }

  return "net:direct";
};

export const resolveActor = (request: Request, config: AppConfig): Actor => {
  if (resolveAdmin(request, config)) {
    return ActorConstructors.Admin({ userId: "admin" });
  }

  return ActorConstructors.Guest();
};

export const corsPreflight = (request: Request, config: AppConfig): Response | null => {
  if (request.method !== "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin") ?? "";
  const headers = new Headers(securityHeaders());

  if (config.corsOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Request-Id");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(null, { status: 204, headers });
};

export const corsHeadersFor = (request: Request, config: AppConfig): Headers => {
  const headers = new Headers();
  const origin = request.headers.get("origin") ?? "";

  if (origin.length > 0 && config.corsOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return headers;
};

export const securityHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return headers;
};

export const responseHeaders = (
  request: Request,
  config: AppConfig,
  requestId: string,
  extraHeaders?: Headers,
): Headers => {
  const headers = new Headers(securityHeaders());
  const cors = corsHeadersFor(request, config);
  cors.forEach((value, key) => headers.set(key, value));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-Id", requestId);

  if (extraHeaders !== undefined) {
    extraHeaders.forEach((value, key) => headers.set(key, value));
  }

  return headers;
};

export const errorResponse = (
  request: Request,
  config: AppConfig,
  requestId: string,
  tag: string,
  message: string,
  extraHeaders?: Headers,
): Response => {
  const mapping = troubleCodeFor(tag);

  return Response.json(apiErrorBody(mapping.code, message, requestId), {
    status: mapping.status,
    headers: responseHeaders(request, config, requestId, extraHeaders),
  });
};

export const rateLimitHeaders = (retryAfterSeconds: number, limit: number): Headers => {
  const headers = new Headers();
  headers.set("Retry-After", String(retryAfterSeconds));
  headers.set("RateLimit-Limit", String(limit));
  headers.set("RateLimit-Remaining", "0");

  return headers;
};
