/**
 * Emits Better Auth's PostgreSQL DDL for review into a Flyway migration.
 * Codegen only: stub credentials are never used at runtime.
 *
 *   DATABASE_URL=postgres://user:pass@host:port/db bun scripts/generate-auth-migration.ts
 *
 * The pool connects lazily; whether codegen touches the live database is
 * verified by running it against an unreachable host (see the migration
 * runbook). All imports are dynamic because static imports would execute
 * before the stub environment below is installed.
 */
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";

process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

process.env.BETTER_AUTH_SECRET ??= "stub-secret-with-at-least-32-characters";

process.env.GOOGLE_CLIENT_ID ??= "stub";

process.env.GOOGLE_CLIENT_SECRET ??= "stub";

process.env.FACEBOOK_CLIENT_ID ??= "stub";

process.env.FACEBOOK_CLIENT_SECRET ??= "stub";

process.env.SMTP_HOST ??= "localhost";

process.env.SMTP_PORT ??= "1025";

process.env.SMTP_USERNAME ??= "stub";

process.env.SMTP_PASSWORD ??= "stub";

process.env.EMAIL_FROM ??= "stub@example.com";

const { serverEnv } = await import("@/server/env");
const { buildAuthOptions } = await import("@/server/auth/options");
const { createAuthPool } = await import("@/server/auth/database");
const { getMigrations } = await import("better-auth/db/migration");

const env = serverEnv();
const pool = createAuthPool(env.DATABASE_URL);

try {
  const { compileMigrations } = await getMigrations(buildAuthOptions(env, async () => {}, pool));

  process.stdout.write(`${await compileMigrations()}\n`);
} finally {
  await pool.end();
}

process.exit(0);
