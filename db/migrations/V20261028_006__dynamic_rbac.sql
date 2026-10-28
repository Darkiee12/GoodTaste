-- Dynamic, database-managed RBAC (Discord-style, global to FeastJourney).
--
-- Design: docs/architecture/access-control.md. The static permission
-- vocabulary lives in code (`src/server/auth/permissions.ts`); this migration
-- seeds the catalog plus the system roles. Custom roles, grants, and
-- assignments are runtime data owned by administrators through the role
-- management operations, never by later migrations.
--
-- Identifiers: role ids are immutable TEXT (system roles use fixed keys,
-- custom roles get `role_<random>` ids at creation). Slugs are unique and
-- mutable for display/ordering. Permission keys are the static vocabulary;
-- inserting an unknown key is rejected by application code, not by FK, so
-- that renaming a permission is a deliberate data migration.
-- user_roles and role_permissions use composite primary keys: no duplicates.

CREATE TABLE feastjourney.roles (
  id TEXT NOT NULL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6b7280' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  position INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_protected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feastjourney.permissions (
  key TEXT NOT NULL PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE feastjourney.role_permissions (
  role_id TEXT NOT NULL REFERENCES feastjourney.roles (id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES feastjourney.permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE feastjourney.user_roles (
  user_id TEXT NOT NULL REFERENCES "feastjourney"."user" (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES feastjourney.roles (id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by TEXT,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_user_id_idx ON feastjourney.user_roles (user_id);
CREATE INDEX role_permissions_role_id_idx ON feastjourney.role_permissions (role_id);

-- Static permission catalog. Keys must match the application vocabulary;
-- adding a key here without application support grants nothing enforceable.
INSERT INTO feastjourney.permissions (key, description, category) VALUES
  ('food:read', 'Read public food information', 'food'),
  ('food:create', 'Create catalog dishes', 'food'),
  ('food:update', 'Update catalog dishes', 'food'),
  ('food:publish', 'Publish catalog dishes', 'food'),
  ('restaurant:read', 'Read public restaurant information', 'restaurant'),
  ('restaurant:submit', 'Submit restaurant serving claims', 'restaurant'),
  ('restaurant:verify', 'Verify restaurant serving claims', 'restaurant'),
  ('favorite:create', 'Save own favorites', 'favorite'),
  ('favorite:read', 'Read own favorites', 'favorite'),
  ('favorite:delete', 'Delete own favorites', 'favorite'),
  ('profile:read', 'Read own profile', 'profile'),
  ('profile:update', 'Update own profile', 'profile'),
  ('session:revoke-own', 'Revoke own sessions', 'session'),
  ('session:revoke-any', 'Revoke any user sessions', 'session'),
  ('session:list-own', 'List own sessions', 'session'),
  ('session:list-any', 'List any user sessions', 'session'),
  ('moderation:read', 'Read moderation queue', 'moderation'),
  ('moderation:resolve', 'Resolve moderation reports', 'moderation'),
  ('support:read', 'Read support views', 'support'),
  ('support:manage', 'Perform support operations', 'support'),
  ('user:read', 'Read user records', 'user'),
  ('user:ban', 'Suspend and restore users', 'user'),
  ('user:manage-roles', 'Change user role assignments', 'user'),
  ('role:create', 'Create custom roles', 'role'),
  ('role:read', 'Read roles and grants', 'role'),
  ('role:update', 'Edit role metadata', 'role'),
  ('role:delete', 'Delete eligible roles', 'role'),
  ('role:assign', 'Assign and remove manageable roles', 'role'),
  ('role:manage-permissions', 'Edit role permission grants', 'role'),
  ('role:manage-protected', 'Manage protected roles and ownership', 'role'),
  ('admin:access', 'Access administration surfaces', 'admin'),
  ('audit:read', 'Read the security audit log', 'audit');

-- System roles. Member/curator/moderator/support/admin mirror the previous
-- static grants; owner is protected and bootstrapped out of band.
INSERT INTO feastjourney.roles (id, slug, name, description, color, position, is_system, is_protected) VALUES
  ('member', 'member', 'Member', 'Personal collections and preferences', '#3b82f6', 10, true, false),
  ('curator', 'curator', 'Curator', 'Edits and maintains curated food records', '#22c55e', 20, true, false),
  ('moderator', 'moderator', 'Moderator', 'Reviews community submissions and reports', '#eab308', 30, true, false),
  ('support', 'support', 'Support', 'Limited account-support operations', '#a855f7', 40, true, false),
  ('admin', 'admin', 'Admin', 'Authorized administration', '#ef4444', 50, true, false),
  ('owner', 'owner', 'Owner', 'Recoverable top-level ownership; cannot be removed while last', '#111827', 100, true, true);

-- Member grants: read public domains, own data, own sessions.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'member', key FROM (VALUES
  ('food:read'), ('restaurant:read'), ('restaurant:submit'),
  ('favorite:create'), ('favorite:read'), ('favorite:delete'),
  ('profile:read'), ('profile:update'),
  ('session:revoke-own'), ('session:list-own')
) AS grants(key);

-- Curator grants: member grants plus catalog authorship. Enforcement for
-- catalog writes migrates from the admin key to these grants separately.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'curator', key FROM (VALUES
  ('food:read'), ('restaurant:read'), ('restaurant:submit'),
  ('favorite:create'), ('favorite:read'), ('favorite:delete'),
  ('profile:read'), ('profile:update'),
  ('session:revoke-own'), ('session:list-own'),
  ('food:create'), ('food:update'), ('food:publish')
) AS grants(key);

-- Moderator grants: member grants plus moderation queue.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'moderator', key FROM (VALUES
  ('food:read'), ('restaurant:read'), ('restaurant:submit'),
  ('favorite:create'), ('favorite:read'), ('favorite:delete'),
  ('profile:read'), ('profile:update'),
  ('session:revoke-own'), ('session:list-own'),
  ('moderation:read'), ('moderation:resolve')
) AS grants(key);

-- Support grants: member grants plus read-only user/support views.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'support', key FROM (VALUES
  ('food:read'), ('restaurant:read'), ('restaurant:submit'),
  ('favorite:create'), ('favorite:read'), ('favorite:delete'),
  ('profile:read'), ('profile:update'),
  ('session:revoke-own'), ('session:list-own'),
  ('user:read'), ('support:read'), ('session:list-any'), ('audit:read')
) AS grants(key);

-- Admin grants: everything except ownership of protected roles.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'admin', key FROM feastjourney.permissions WHERE key <> 'role:manage-protected';

-- Owner grants: every permission including protected-role management.
INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'owner', key FROM feastjourney.permissions;

-- Backfill: every existing user keeps at least member access; known static
-- roles map to same-named system roles, unknown values fall back to member.
INSERT INTO feastjourney.user_roles (user_id, role_id)
SELECT u.id,
  CASE WHEN r.id IS NOT NULL THEN r.id ELSE 'member' END
FROM "feastjourney"."user" AS u
LEFT JOIN feastjourney.roles AS r ON r.id = COALESCE(u.role, 'member')
ON CONFLICT (user_id, role_id) DO NOTHING;
