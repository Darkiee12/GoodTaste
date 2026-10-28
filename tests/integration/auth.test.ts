// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";
import { z } from "zod";

import { RoleId, UserId } from "@/modules/user/server/domain/identifiers";
import { UserAdminService } from "@/modules/user/server/operations/admin-service";
import { RoleService } from "@/modules/user/server/operations/role-service";
import { SessionService } from "@/modules/user/server/operations/session-service";
import { FavoritesService, ProfileService } from "@/modules/user/server/operations/user-services";
import { Actor } from "@/server/auth/actor";
import { createAuth, buildAuthOptions } from "@/server/auth/options";
import { requireAuthenticatedActor, requirePermission } from "@/server/auth/session";
import type { ServerEnv } from "@/server/env";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

const testEnv: ServerEnv = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
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

interface SentEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

const sent: Array<SentEmail> = [];

const testAuth = createAuth({
  ...buildAuthOptions(
    testEnv,
    async (email) => {
      sent.push(email);
    },
    false,
  ),
  rateLimit: { enabled: false },
});

const run = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  appRuntime.runPromise(effect);

const call = async (path: string, init?: RequestInit): Promise<Response> =>
  testAuth.handler(new Request(`http://localhost:3000${path}`, init));

const json = (body: Record<string, string>, headers?: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const cookiesOf = (response: Response): string => {
  const setCookies = response.headers.getSetCookie();

  return setCookies
    .map((entry) => entry.split(";")[0] ?? "")
    .filter((entry) => entry.length > 0)
    .join("; ");
};

const withCookies = (cookies: string): HeadersInit => ({ cookie: cookies });

/** Extracts the signed-in user id from a get-session response. */
const sessionUserSchema = z.object({ user: z.object({ id: z.string() }) });

const expectUserId = async (response: Response): Promise<string> => {
  const parsed = sessionUserSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error("expected a session user");
  }

  return parsed.data.user.id;
};

const tokenFrom = (text: string): string => {
  const match = /token=([^&\s"']+)/.exec(text) ?? /reset-password\/([^?\s"']+)/.exec(text);

  if (match === null || match[1] === undefined) {
    throw new Error(`no token in email: ${text.slice(0, 200)}`);
  }

  return match[1];
};

const stamp = Date.now().toString(36);
const emailOf = (name: string): string => `${name}-${stamp}@example.com`;

/** getSession answers 200 with a null body when no session is active. */
const expectNoSession = async (response: Response): Promise<void> => {
  const body: unknown = await response.json();
  const parsed = z.object({ session: z.unknown() }).safeParse(body);

  expect(body === null || (parsed.success && parsed.data.session === null)).toBe(true);
};

const createdUserIds: Array<string> = [];

const grantRole = async (userId: string, roleId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING`;
  await sql.end();
};

const signupVerifySignin = async (
  name: string,
): Promise<{ userId: string; cookies: string; email: string }> => {
  const email = emailOf(name);
  sent.length = 0;

  const signup = await call(
    "/api/auth/sign-up/email",
    json({ name, email, password: "correct-horse-123" }),
  );

  expect([200, 302]).toContain(signup.status);

  const verifyToken = tokenFrom(sent.find((entry) => entry.to === email)?.text ?? "");
  const verified = await call(`/api/auth/verify-email?token=${verifyToken}&callbackURL=/`);

  expect([200, 302]).toContain(verified.status);

  const signin = await call(
    "/api/auth/sign-in/email",
    json({ email, password: "correct-horse-123" }),
  );

  expect([200, 302]).toContain(signin.status);

  const cookies = cookiesOf(signin);

  expect(cookies).toContain("better-auth.session_token");

  const session = await call("/api/auth/get-session", { headers: withCookies(cookies) });
  const userId = await expectUserId(session);
  createdUserIds.push(userId);

  return { userId, cookies, email };
};

beforeAll(() => {
  expect(process.env.DATABASE_URL).toBeTruthy();
});

afterAll(async () => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await Promise.all(
    createdUserIds.map((id) => sql`DELETE FROM "feastjourney"."user" WHERE id = ${id}`),
  );

  await sql.end();
});

describe("email registration and verification", () => {
  test("creates an unverified user and blocks sign-in until verification", async () => {
    const email = emailOf("unverified");
    sent.length = 0;

    const signup = await call(
      "/api/auth/sign-up/email",
      json({ name: "Un", email, password: "correct-horse-123" }),
    );

    expect([200, 302]).toContain(signup.status);

    const sessionCookie = cookiesOf(signup);
    expect(sessionCookie).not.toContain("better-auth.session_token");

    const early = await call(
      "/api/auth/sign-in/email",
      json({ email, password: "correct-horse-123" }),
    );

    expect(early.status).not.toBe(200);

    const token = tokenFrom(sent.find((entry) => entry.to === email)?.text ?? "");
    await call(`/api/auth/verify-email?token=${token}&callbackURL=/`);

    const signin = await call(
      "/api/auth/sign-in/email",
      json({ email, password: "correct-horse-123" }),
    );

    expect([200, 302]).toContain(signin.status);
    expect(cookiesOf(signin)).toContain("better-auth.session_token");

    const session = await call("/api/auth/get-session", {
      headers: withCookies(cookiesOf(signin)),
    });

    const userId = await expectUserId(session);
    createdUserIds.push(userId);
  });

  test("rejects wrong passwords", async () => {
    const { email } = await signupVerifySignin("wrongpw");
    const bad = await call("/api/auth/sign-in/email", json({ email, password: "nope-nope-nope" }));

    expect(bad.status).not.toBe(200);
  });
});

describe("session lifecycle", () => {
  test("lists, revokes one, keeps the other, revokes all", async () => {
    const first = await signupVerifySignin("devices");

    const both = await call(
      "/api/auth/sign-in/email",
      json({ email: first.email, password: "correct-horse-123" }),
    );

    const secondCookies = cookiesOf(both);

    const listed = await run(
      Effect.flatMap(SessionService, (service) =>
        service.listSessions(new Headers(withCookies(first.cookies))),
      ),
    );

    expect(listed.length).toBe(2);
    expect(listed.filter((entry) => entry.current).length).toBe(1);

    const other = listed.find((entry) => !entry.current);

    if (other === undefined) {
      throw new Error("expected a second session");
    }

    await run(
      Effect.flatMap(SessionService, (service) =>
        service.revokeSession(new Headers(withCookies(first.cookies)), other.token),
      ),
    );

    const afterRevoke = await call("/api/auth/get-session", {
      headers: withCookies(secondCookies),
    });

    await expectNoSession(afterRevoke);

    const stillValid = await call("/api/auth/get-session", { headers: withCookies(first.cookies) });

    expect(stillValid.status).toBe(200);

    await run(
      Effect.flatMap(SessionService, (service) =>
        service.revokeAllSessions(new Headers(withCookies(first.cookies))),
      ),
    );

    const gone = await call("/api/auth/get-session", { headers: withCookies(first.cookies) });

    await expectNoSession(gone);
  });

  test("expired sessions are rejected", async () => {
    const { userId, cookies } = await signupVerifySignin("expired");
    const sql = new SQL(process.env.DATABASE_URL ?? "");

    await sql`UPDATE "feastjourney"."session" SET "expiresAt" = now() - interval '1 hour' WHERE "userId" = ${userId}`;
    await sql.end();

    const expired = await call("/api/auth/get-session", { headers: withCookies(cookies) });

    await expectNoSession(expired);

    const exit = await appRuntime.runPromiseExit(
      requireAuthenticatedActor(new Headers(withCookies(cookies))),
    );

    expect(exit._tag).toBe("Failure");
  });

  test("suspended users fail closed on every guarded operation", async () => {
    const { userId, cookies } = await signupVerifySignin("banned");
    const sql = new SQL(process.env.DATABASE_URL ?? "");

    await sql`UPDATE "feastjourney"."user" SET banned = true WHERE id = ${userId}`;
    await sql.end();

    const exit = await appRuntime.runPromiseExit(
      requireAuthenticatedActor(new Headers(withCookies(cookies))),
    );

    expect(exit._tag).toBe("Failure");
  });
});

describe("password recovery", () => {
  test("reset issues a new password and revokes pre-existing sessions", async () => {
    const { email, cookies: oldCookies } = await signupVerifySignin("recovery");
    sent.length = 0;

    const requested = await call(
      "/api/auth/request-password-reset",
      json({ email, redirectTo: "/reset-password" }),
    );

    expect([200, 302]).toContain(requested.status);

    const resetToken = tokenFrom(sent[sent.length - 1]?.text ?? "");

    const reset = await call(
      "/api/auth/reset-password",
      json({ newPassword: "brand-new-password-456", token: resetToken }),
    );

    expect([200, 302]).toContain(reset.status);

    const revoked = await call("/api/auth/get-session", { headers: withCookies(oldCookies) });

    await expectNoSession(revoked);

    const signin = await call(
      "/api/auth/sign-in/email",
      json({ email, password: "brand-new-password-456" }),
    );

    expect([200, 302]).toContain(signin.status);
  });
});

describe("profile and favorites ownership", () => {
  test("members manage only their own data", async () => {
    const alice = await signupVerifySignin("alice");
    const bob = await signupVerifySignin("bob");

    await run(
      Effect.flatMap(ProfileService, (service) =>
        service.updateProfile({ userId: alice.userId, displayName: "Alice", locale: "en" }),
      ),
    );

    const profile = await run(
      Effect.flatMap(ProfileService, (service) => service.getProfile(alice.userId)),
    );

    expect(profile?.display_name).toBe("Alice");

    const bobProfile = await run(
      Effect.flatMap(ProfileService, (service) => service.getProfile(bob.userId)),
    );

    expect(bobProfile).toBeNull();

    await run(
      Effect.flatMap(FavoritesService, (service) => service.addFavorite(alice.userId, "1")),
    );

    const duplicate = await appRuntime.runPromiseExit(
      Effect.flatMap(FavoritesService, (service) => service.addFavorite(alice.userId, "1")),
    );

    expect(duplicate._tag).toBe("Failure");

    await run(Effect.flatMap(FavoritesService, (service) => service.addFavorite(bob.userId, "1")));

    const aliceFavorites = await run(
      Effect.flatMap(FavoritesService, (service) => service.listFavorites(alice.userId, 20)),
    );

    expect(aliceFavorites.length).toBe(1);

    await run(
      Effect.flatMap(FavoritesService, (service) => service.removeFavorite(alice.userId, "1")),
    );

    const removed = await appRuntime.runPromiseExit(
      Effect.flatMap(FavoritesService, (service) => service.removeFavorite(alice.userId, "1")),
    );

    expect(removed._tag).toBe("Failure");

    const bobFavorites = await run(
      Effect.flatMap(FavoritesService, (service) => service.listFavorites(bob.userId, 20)),
    );

    expect(bobFavorites.length).toBe(1);
  });

  test("guests cannot use member operations and members cannot reach admin", async () => {
    const guestDenied = await appRuntime.runPromiseExit(
      requirePermission(new Headers(), [{ resource: "favorite", actions: ["create"] }]),
    );

    expect(guestDenied._tag).toBe("Failure");

    const member = await signupVerifySignin("plain");

    const adminDenied = await appRuntime.runPromiseExit(
      requirePermission(new Headers(withCookies(member.cookies)), [
        { resource: "user", actions: ["ban"] },
        { resource: "admin", actions: ["access"] },
      ]),
    );

    expect(adminDenied._tag).toBe("Failure");
  });
});

describe("administration", () => {
  test("admin manages roles while support cannot escalate", async () => {
    const admin = await signupVerifySignin("root");
    const member = await signupVerifySignin("pleb");

    await grantRole(admin.userId, "admin");
    await grantRole(admin.userId, "owner");

    const adminActor = Actor.Member({ userId: admin.userId });
    const memberActor = Actor.Member({ userId: member.userId });

    const users = await run(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(adminActor, 20, 0)),
    );

    expect(users.length).toBeGreaterThan(1);

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(adminActor, UserId.parse(member.userId), RoleId.parse("support")),
      ),
    );

    const escalate = await appRuntime.runPromiseExit(
      Effect.flatMap(RoleService, (service) =>
        service.assignRole(memberActor, UserId.parse(admin.userId), RoleId.parse("admin")),
      ),
    );

    expect(escalate._tag).toBe("Failure");

    const supportDenied = await appRuntime.runPromiseExit(
      Effect.flatMap(UserAdminService, (service) => service.listUsers(memberActor, 20, 0)),
    );

    expect(supportDenied._tag).toBe("Failure");

    await run(
      Effect.flatMap(RoleService, (service) =>
        service.removeRole(adminActor, UserId.parse(member.userId), RoleId.parse("support")),
      ),
    );
  });

  test("banning revokes all sessions immediately", async () => {
    const admin = await signupVerifySignin("banner");
    const target = await signupVerifySignin("target");

    await grantRole(admin.userId, "admin");

    const adminActor = Actor.Member({ userId: admin.userId });

    await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.banUser(adminActor, UserId.parse(target.userId), "test ban"),
      ),
    );

    const revoked = await call("/api/auth/get-session", { headers: withCookies(target.cookies) });

    await expectNoSession(revoked);

    await run(
      Effect.flatMap(UserAdminService, (service) =>
        service.unbanUser(adminActor, UserId.parse(target.userId)),
      ),
    );
  });
});

describe("account linking guard", () => {
  test("refuses to remove the last sign-in method", async () => {
    const { cookies } = await signupVerifySignin("linked");

    const denied = await appRuntime.runPromiseExit(
      Effect.flatMap(SessionService, (service) =>
        service.unlinkAccount(new Headers(withCookies(cookies)), "password:only"),
      ),
    );

    expect(denied._tag).toBe("Failure");
  });
});

describe("social sign-in", () => {
  test("generates a provider authorization URL", async () => {
    const response = await call(
      "/api/auth/sign-in/social",
      json({ provider: "google", callbackURL: "/" }),
    );

    expect([200, 302]).toContain(response.status);

    const body: unknown = await response.json();
    const parsed = z.object({ url: z.string() }).safeParse(body);

    expect(parsed.success && parsed.data.url).toContain("accounts.google.com");
  });

  test("rejects callback without a valid code", async () => {
    const response = await call("/api/auth/callback/google?code=invalid&state=invalid");

    expect(response.status).not.toBe(200);
  });
});
