-- Explicit import-management permission for bulk catalog imports.
--
-- The admin-key bypass previously gated validate/apply behind a shared
-- secret. Imports now require `food:import` through dynamic RBAC, so bulk
-- writes are granted only to catalog roles (curator), administrators, and
-- owners. See docs/architecture/access-control.md.

INSERT INTO feastjourney.permissions (key, description, category) VALUES
  ('food:import', 'Validate and apply bulk catalog imports', 'food')
ON CONFLICT (key) DO NOTHING;

INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT role_id, 'food:import'
FROM (VALUES ('curator'), ('admin'), ('owner')) AS grants(role_id)
ON CONFLICT DO NOTHING;
