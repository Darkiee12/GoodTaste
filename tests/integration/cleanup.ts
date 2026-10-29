import { applyTestEnvDefaults, isDisposableTestDatabase } from "../bootstrap";

// Fixture tracking for integration suites that create catalog rows and delete
// only what they own. Environment setup and the disposable-database guard
// live in `tests/bootstrap.ts` (preloaded before any test module evaluates);
// the calls below are a fallback so direct file runs keep working even if
// the preload configuration is bypassed.
applyTestEnvDefaults(process.env);

if (!isDisposableTestDatabase(process.env["DATABASE_URL"])) {
  throw new Error(
    "Refusing to run integration tests: DATABASE_URL does not point at the disposable loopback feastjourney test database",
  );
}

export const createdSlugs: Array<string> = [];
