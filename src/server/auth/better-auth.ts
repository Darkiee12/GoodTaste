import { createAuthPool } from "@/server/auth/database";
import { buildAuthOptions, createAuth } from "@/server/auth/options";
import { sendOutboundEmail } from "@/server/email";
import { serverEnv } from "@/server/env";

/**
 * Production Better Auth singleton. Validates the environment on first import
 * (startup fails loudly on missing secrets) and mounts at
 * `src/routes/api/auth/$.ts`. Tests build isolated instances via
 * `createAuth` with stub credentials and a memory sender. The pool is created
 * once here and passed explicitly; nothing else constructs auth pools.
 */
const env = serverEnv();

export const authPool = createAuthPool(env.DATABASE_URL);

export const auth = createAuth(buildAuthOptions(env, sendOutboundEmail, authPool));

export type Auth = typeof auth;
