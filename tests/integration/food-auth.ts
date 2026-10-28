import { SQL } from "bun";
import { z } from "zod";

import { createAuthPool } from "@/server/auth/database";
import { buildAuthOptions, createAuth } from "@/server/auth/options";
import type { ServerEnv } from "@/server/env";

/**
 * Session-first authentication helper for food-admin HTTP tests. Users are
 * registered through the real Better Auth email flow (signup, verify,
 * sign-in) against an isolated auth instance with an in-memory mail sender;
 * role grants go straight to PostgreSQL. Request cookies produced here are
 * honored by the application handlers because both instances share the same
 * database and secret.
 *
 * One context per test file: create it at file scope (after importing
 * `./cleanup`), close it in `afterAll`.
 */

const testEnv = (): ServerEnv => ({
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  BETTER_AUTH_URL: "http://localhost:3000",
  // Must match the application singleton's secret: session cookies are
  // signed, so an isolated auth instance with a different secret mints
  // cookies the handlers cannot verify. cleanup.ts guarantees this is set.
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
});

const sessionUserSchema = z.object({ user: z.object({ id: z.string() }) });

export interface FoodAuthSession {
  readonly userId: string;
  readonly cookies: string;
  readonly email: string;
}

export interface FoodAuthContext {
  readonly createdUserIds: Array<string>;
  readonly signupSignin: (name: string) => Promise<FoodAuthSession>;
  readonly grantRole: (userId: string, roleId: string) => Promise<void>;
  readonly revokeRole: (userId: string, roleId: string) => Promise<void>;
  readonly suspendUser: (userId: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

const jsonBody = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0] ?? "")
    .filter((entry) => entry.length > 0)
    .join("; ");

const tokenFrom = (text: string): string => {
  const match = /token=([^&\s"']+)/.exec(text) ?? /reset-password\/([^?\s"']+)/.exec(text);

  if (match === null || match[1] === undefined) {
    throw new Error(`no token in email: ${text.slice(0, 200)}`);
  }

  return match[1];
};

export const createFoodAuth = (): FoodAuthContext => {
  const pool = createAuthPool(process.env.DATABASE_URL ?? "");
  const sent: Array<{ readonly to: string; readonly text: string }> = [];

  const auth = createAuth({
    ...buildAuthOptions(
      testEnv(),
      async (email) => {
        sent.push(email);
      },
      pool,
      false,
    ),
    rateLimit: { enabled: false },
  });

  const createdUserIds: Array<string> = [];
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const call = (path: string, init?: RequestInit): Promise<Response> =>
    auth.handler(new Request(`http://localhost:3000${path}`, init));

  const signupSignin = async (name: string): Promise<FoodAuthSession> => {
    const email = `${name}-${stamp}@example.com`;
    sent.length = 0;

    const signup = await call(
      "/api/auth/sign-up/email",
      jsonBody({ name, email, password: "correct-horse-123" }),
    );

    if (signup.status !== 200 && signup.status !== 302) {
      throw new Error(`signup failed with ${signup.status}`);
    }

    const verifyToken = tokenFrom(sent.find((entry) => entry.to === email)?.text ?? "");
    await call(`/api/auth/verify-email?token=${verifyToken}&callbackURL=/`);

    const signin = await call(
      "/api/auth/sign-in/email",
      jsonBody({ email, password: "correct-horse-123" }),
    );

    if (signin.status !== 200 && signin.status !== 302) {
      throw new Error(`signin failed with ${signin.status}`);
    }

    const cookies = cookiesOf(signin);

    if (!cookies.includes("better-auth.session_token")) {
      throw new Error("signin did not issue a session cookie");
    }

    const session = await call("/api/auth/get-session", { headers: { cookie: cookies } });
    const parsed = sessionUserSchema.safeParse(await session.json());

    if (!parsed.success) {
      throw new Error("expected a session user after signin");
    }

    createdUserIds.push(parsed.data.user.id);

    return { userId: parsed.data.user.id, cookies, email };
  };

  const close = async (): Promise<void> => {
    await pool.end();
    const sql = new SQL(process.env.DATABASE_URL ?? "");

    await Promise.all(
      createdUserIds.map((id) => sql`DELETE FROM "feastjourney"."user" WHERE id = ${id}`),
    );
    await sql.end();
  };

  return {
    createdUserIds,
    signupSignin,
    grantRole: grantRoleSql,
    revokeRole: revokeRoleSql,
    suspendUser: suspendUserSql,
    close,
  };
};

/** Request headers carrying a Better Auth session cookie. */
export const sessionHeaders = (cookies: string) => ({
  cookie: cookies,
  "content-type": "application/json",
});

const grantRoleSql = async (userId: string, roleId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`INSERT INTO feastjourney.user_roles (user_id, role_id) VALUES (${userId}, ${roleId}) ON CONFLICT DO NOTHING`;
  await sql.end();
};

const revokeRoleSql = async (userId: string, roleId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`DELETE FROM feastjourney.user_roles WHERE user_id = ${userId} AND role_id = ${roleId}`;
  await sql.end();
};

const suspendUserSql = async (userId: string): Promise<void> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  await sql`UPDATE "feastjourney"."user" SET banned = true WHERE id = ${userId}`;
  await sql.end();
};
