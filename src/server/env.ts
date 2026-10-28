import { z } from "zod";

/**
 * Server-only environment validation. Imported exclusively from server code
 * (Better Auth setup, email transport, TanStack server handlers); never from
 * browser components or client-safe schemas. All authentication providers and
 * email delivery are mandatory: startup fails loudly instead of silently
 * disabling Google, Facebook, or email.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a valid URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  FACEBOOK_CLIENT_ID: z.string().min(1, "FACEBOOK_CLIENT_ID is required"),
  FACEBOOK_CLIENT_SECRET: z.string().min(1, "FACEBOOK_CLIENT_SECRET is required"),
  SMTP_HOST: z.string().min(1, "SMTP_HOST is required"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USERNAME: z.string().min(1, "SMTP_USERNAME is required"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD is required"),
  EMAIL_FROM: z.string().min(1, "EMAIL_FROM is required"),
  TRUSTED_PROXIES: z.string().default(""),
  // Optional Muse ranking integration. Every MODEL_* field stays optional
  // in both input and output so startup never depends on AI configuration
  // and existing ServerEnv literals keep compiling; modelConfig() below
  // applies the documented defaults at the use site.
  MODEL_API_KEY: z.string().optional(),
  MODEL_MODEL_ID: z.string().optional(),
  MODEL_BASE_URL: z.string().optional(),
  MODEL_TIMEOUT_MS: z.coerce.number().int().optional(),
  MODEL_CANDIDATE_LIMIT: z.coerce.number().int().max(100).optional(),
  MODEL_OUTPUT_LIMIT: z.coerce.number().int().optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export const serverEnv = (): ServerEnv => {
  cached ??= envSchema.parse(process.env);

  return cached;
};

/** Test-only escape hatch: reset the cached parse between cases. */
export const resetServerEnvCache = (): void => {
  cached = undefined;
};

export interface ModelConfig {
  readonly apiKey: string | undefined;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly candidateLimit: number;
  readonly outputLimit: number;
}

/** Documented defaults for the optional Muse ranking integration. */
export const modelConfig = (): ModelConfig => {
  const env = serverEnv();

  return {
    apiKey: env.MODEL_API_KEY,
    modelId: env.MODEL_MODEL_ID ?? "muse-spark-1.3",
    baseUrl: env.MODEL_BASE_URL ?? "https://api.meta.ai/v1",
    timeoutMs: env.MODEL_TIMEOUT_MS ?? 15000,
    candidateLimit: env.MODEL_CANDIDATE_LIMIT ?? 60,
    outputLimit: env.MODEL_OUTPUT_LIMIT ?? 10,
  };
};
