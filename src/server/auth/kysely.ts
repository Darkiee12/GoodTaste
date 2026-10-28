import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import { serverEnv } from "@/server/env";

/**
 * Dedicated pg pool + Kysely instance for Better Auth's own tables.
 * Application SQL stays with Reylo; Better Auth internally requires Kysely,
 * so it gets an isolated client that never leaks into domain repositories.
 *
 * Why not pass the raw pg Pool (as the Better Auth docs show)? The raw-Pool
 * form has no `schemaName` key; schema would come only implicitly from the
 * connection's `search_path`. This repo mandates the `feastjourney` schema,
 * hence the explicit wrapper so migrator, runtime, and schema checks agree.
 */
const pool = new Pool({ connectionString: serverEnv().DATABASE_URL, max: 5 });

export const authDb = new Kysely<Record<string, never>>({
  dialect: new PostgresDialect({ pool }),
});
