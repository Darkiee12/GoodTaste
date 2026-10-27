// Shared integration-test setup. Runs at import time, before the first
// application runtime is built, so the test process gets generous quotas.
// Rate-limit behavior itself is covered by rate-limit.test.ts with its own
// runtime; these values only keep unrelated integration tests independent.
process.env.DATABASE_URL ??= "postgres://feastjourney:fj-local-dev-pw@127.0.0.1:5433/feastjourney";

process.env.ADMIN_API_KEY ??= "test-admin-key";

process.env.RATE_LIMIT_PUBLIC ??= "1000";

process.env.RATE_LIMIT_SEARCH ??= "1000";

process.env.RATE_LIMIT_ADMIN ??= "1000";

export const createdSlugs: Array<string> = [];
