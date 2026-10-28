import { Pool } from "pg";

/**
 * Dedicated pg Pool for Better Auth's own tables, pinned to the
 * `feastjourney` schema via `search_path` (the documented way to select a
 * non-default schema when passing a pool directly:
 * https://better-auth.com/docs/adapters/postgresql#use-a-non-default-schema).
 *
 * Better Auth wraps this pool in its own Kysely dialect internally; no
 * application code touches Kysely. Application SQL stays with Reylo and this
 * pool never leaks into domain repositories.
 */
export const createAuthPool = (databaseUrl: string): Pool =>
  new Pool({
    connectionString: databaseUrl,
    options: "-c search_path=feastjourney",
    max: 5,
  });
