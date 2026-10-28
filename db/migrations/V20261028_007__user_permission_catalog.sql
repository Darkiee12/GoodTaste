-- Completes the user-management permission catalog. V006 seeded the
-- vocabulary partially; these keys back the user administration service
-- (list/create/delete) and were missing, which made every check against
-- them deny. See docs/architecture/access-control.md.
--
-- Grants follow least privilege: administrators get the operational set,
-- owners get the full set including legacy plugin-action names that are
-- never granted to executable roles.

INSERT INTO feastjourney.permissions (key, description, category) VALUES
  ('user:list', 'List user accounts', 'user'),
  ('user:create', 'Create user accounts', 'user'),
  ('user:delete', 'Delete user accounts', 'user'),
  ('user:set-role', 'Legacy direct role assignment (superseded by role:assign)', 'user'),
  ('user:get', 'Read a single user record', 'user'),
  ('user:update', 'Update user profile fields', 'user'),
  ('user:set-password', 'Reset a user password administratively', 'user'),
  ('user:set-email', 'Change a user email administratively', 'user')
ON CONFLICT (key) DO NOTHING;

INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'admin', key FROM (VALUES
  ('user:list'), ('user:create'), ('user:delete')
) AS grants(key)
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'owner', key FROM (VALUES
  ('user:list'), ('user:create'), ('user:delete'),
  ('user:set-role'), ('user:get'), ('user:update'),
  ('user:set-password'), ('user:set-email')
) AS grants(key)
ON CONFLICT DO NOTHING;
