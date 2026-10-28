-- FeastJourney authentication and member tables.
--
-- Part 1 (Better Auth core + admin plugin + database rate limiting) is
-- generated from the installed better-auth version, not hand-designed:
--   bun scripts/generate-auth-migration.ts
-- Reviewer: regenerate and diff after any better-auth upgrade. Never edit the
-- generated block's columns to "improve" it; write a new migration instead.
-- Keywords below are uppercased per repo convention; quoted camelCase column
-- names are Better Auth's canonical schema and must match its adapter.
--
-- Part 2 (application-owned member tables) is hand-written: user profiles,
-- dish favorites, and the security audit log. Reylo owns queries against
-- these; Better Auth owns its own tables.

-- ---------------------------------------------------------------------------
-- Part 1: Better Auth (generated)
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS "feastjourney";

CREATE TABLE "feastjourney"."user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "role" TEXT,
  "banned" BOOLEAN,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ
);

CREATE TABLE "feastjourney"."session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "feastjourney"."user" ("id") ON DELETE CASCADE,
  "impersonatedBy" TEXT
);

CREATE TABLE "feastjourney"."account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "feastjourney"."user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "feastjourney"."verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "feastjourney"."rateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

CREATE INDEX "session_userId_idx" ON "feastjourney"."session" ("userId");

CREATE INDEX "account_userId_idx" ON "feastjourney"."account" ("userId");

CREATE INDEX "verification_identifier_idx" ON "feastjourney"."verification" ("identifier");

-- ---------------------------------------------------------------------------
-- Part 2: application-owned member tables
-- ---------------------------------------------------------------------------

-- Optional member profile. Identity lives in "user"; preferences live here.
CREATE TABLE feastjourney.user_profiles (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES "feastjourney"."user" ("id") ON DELETE CASCADE,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'vi', 'hi', 'es', 'zh')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved dishes. Dish existence is enforced; ownership is enforced in code
-- (every query predicates on user_id from the verified session actor).
CREATE TABLE feastjourney.favorites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "feastjourney"."user" ("id") ON DELETE CASCADE,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dish_id)
);

CREATE INDEX favorites_user_id_idx ON feastjourney.favorites (user_id);

-- Append-only security audit log. No foreign key to "user": rows must survive
-- account deletion. Never store tokens, passwords, or secrets in metadata.
CREATE TABLE feastjourney.security_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id TEXT,
  session_id TEXT,
  request_id TEXT,
  event TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  reason TEXT,
  resource TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX security_audit_events_event_time_idx
  ON feastjourney.security_audit_events (event, occurred_at DESC);

CREATE INDEX security_audit_events_actor_idx
  ON feastjourney.security_audit_events (actor_user_id, occurred_at DESC);
