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
