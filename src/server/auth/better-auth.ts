import { buildAuthOptions, createAuth } from "@/server/auth/options";
import { sendOutboundEmail } from "@/server/email";
import { serverEnv } from "@/server/env";

/**
 * Production Better Auth singleton. Validates the environment on first import
 * (startup fails loudly on missing secrets) and mounts at
 * `src/routes/api/auth/$.ts`. Tests build isolated instances via
 * `createAuth` with stub credentials and a memory sender.
 */
export const auth = createAuth(buildAuthOptions(serverEnv(), sendOutboundEmail));

export type Auth = typeof auth;
