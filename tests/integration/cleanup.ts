// Shared integration-test setup. Runs at import time, before the first
// application runtime is built, so the test process gets generous quotas.
// Rate-limit behavior itself is covered by rate-limit.test.ts with its own
// runtime; these values only keep unrelated integration tests independent.
process.env.DATABASE_URL ||= "postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney";

process.env.ADMIN_API_KEY ||= "test-admin-key";

process.env.RATE_LIMIT_PUBLIC ||= "1000";

process.env.RATE_LIMIT_SEARCH ||= "1000";

process.env.RATE_LIMIT_ADMIN ||= "1000";

// Stub authentication environment for integration tests. Behavior under test
// uses isolated auth instances with an in-memory mail sender; these values
// only satisfy the startup validation shared with production code paths.
// OAuth credentials are deliberately fake: provider round-trips are mocked.
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

process.env.BETTER_AUTH_SECRET ||= "test-secret-with-at-least-32-characters";

process.env.GOOGLE_CLIENT_ID ||= "test-google-id";

process.env.GOOGLE_CLIENT_SECRET ||= "test-google-secret";

process.env.FACEBOOK_CLIENT_ID ||= "test-facebook-id";

process.env.FACEBOOK_CLIENT_SECRET ||= "test-facebook-secret";

process.env.SMTP_HOST ||= "localhost";

process.env.SMTP_PORT ||= "1025";

process.env.SMTP_USERNAME ||= "test";

process.env.SMTP_PASSWORD ||= "test";

process.env.EMAIL_FROM ||= "test@example.com";

export const createdSlugs: Array<string> = [];
