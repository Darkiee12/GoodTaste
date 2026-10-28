// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { z } from "zod";

import { authPool } from "@/server/auth/better-auth";
import { createAuthPool } from "@/server/auth/database";
import { createAuth, buildAuthOptions } from "@/server/auth/options";
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

const sent: Array<{ to: string; text: string }> = [];

const schemaPool = createAuthPool(process.env.DATABASE_URL ?? "");

const schemaAuth = createAuth({
  ...buildAuthOptions(
    env,
    async (email) => {
      sent.push(email);
    },
    schemaPool,
    false,
  ),
  rateLimit: { enabled: false },
});

const call = (path: string, init?: RequestInit): Promise<Response> =>
  schemaAuth.handler(new Request(`http://localhost:3000${path}`, init));

const json = (body: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const stamp = Date.now().toString(36);

afterAll(async () => {
  await schemaPool.end();
});

describe("auth schema isolation", () => {
  test("the pool resolves unqualified names to feastjourney, not public", async () => {
    const rows = await authPool.query("SHOW search_path");
    const parsed = z.array(z.object({ search_path: z.string() })).safeParse(rows.rows);

    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data[0]?.search_path).toContain("feastjourney");
    }
  });

  test("auth flows ignore same-named tables in public", async () => {
    const sql = new SQL(process.env.DATABASE_URL ?? "");

    // Ownership proof: record whether the decoy tables already exist before
    // touching them. The test only drops tables it created itself; a
    // pre-existing shared object is never adopted and never removed.
    const existed = await sql<Array<{ name: string | null }>>`
      SELECT to_regclass('public."user"') AS name
      UNION ALL
      SELECT to_regclass('public."session"') AS name
    `;

    const decoysExisted = existed.some((row) => row.name !== null);

    if (!decoysExisted) {
      await sql`CREATE TABLE public."user" (id text primary key, marker text)`;
      await sql`CREATE TABLE public."session" (id text primary key, marker text)`;
      await sql`INSERT INTO public."user" (id, marker) VALUES ('decoy-user', 'decoy')`;
      await sql`INSERT INTO public."session" (id, marker) VALUES ('decoy-session', 'decoy')`;
    }

    try {
      const email = `decoy-${stamp}@example.com`;

      const signup = await call(
        "/api/auth/sign-up/email",
        json({ name: "Decoy", email, password: "correct-horse-123" }),
      );

      expect([200, 302]).toContain(signup.status);

      const real = await sql<
        Array<{ count: string }>
      >`SELECT COUNT(*) AS count FROM feastjourney."user" WHERE email = ${email}`;

      expect(Number(real[0]?.count ?? 0)).toBe(1);

      if (!decoysExisted) {
        const decoys = await sql<
          Array<{ count: string }>
        >`SELECT COUNT(*) AS count FROM public."user" WHERE id <> 'decoy-user'`;

        expect(Number(decoys[0]?.count ?? -1)).toBe(0);

        const sessions = await sql<
          Array<{ count: string }>
        >`SELECT COUNT(*) AS count FROM public."session" WHERE id <> 'decoy-session'`;

        expect(Number(sessions[0]?.count ?? -1)).toBe(0);
      }

      await sql`DELETE FROM feastjourney."user" WHERE email = ${email}`;
    } finally {
      if (!decoysExisted) {
        // Owned fixtures only: these tables did not exist before this test.
        await sql`DROP TABLE public."session"`;
        await sql`DROP TABLE public."user"`;
      } else {
        // A pre-existing shared object must survive the test untouched.
        const survived = await sql<Array<{ name: string | null }>>`
          SELECT to_regclass('public."user"') AS name
        `;

        expect(survived.some((row) => row.name !== null)).toBe(true);
      }

      await sql.end();
    }
  });
});
