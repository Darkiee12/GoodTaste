/**
 * Emits Better Auth's PostgreSQL DDL for review into a Flyway migration.
 * Codegen only: stub credentials are never used at runtime, and no database
 * connection is opened (DDL comes from table definitions, not the live DB).
 *
 *   bun scripts/generate-auth-migration.ts
 *
 * All imports are dynamic because static imports would execute before the
 * stub environment below is installed (notably kysely.ts, which validates
 * env at module scope).
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
const { getMigrations } = await import("better-auth/db/migration");

const { compileMigrations } = await getMigrations(buildAuthOptions(serverEnv(), async () => {}));

process.stdout.write(`${await compileMigrations()}\n`);

process.exit(0);
