-- Remove the orphaned user:read permission key.
--
-- V006 seeded user:read and granted it to support/admin/owner, but the
-- application vocabulary (src/server/auth/permissions.ts) never contained
-- it: V007 superseded it with user:list/user:get and no operation checks
-- user:read. An unknown key can never satisfy a typed PermissionRequest,
-- so the row was dead weight that disagreed with the documented
-- "vocabulary defined once in code" contract.
--
-- Support keeps its documented read-only user view through user:list
-- (granted here; admin/owner already hold it from V007).

DELETE FROM feastjourney.role_permissions WHERE permission_key = 'user:read';
DELETE FROM feastjourney.permissions WHERE key = 'user:read';

INSERT INTO feastjourney.role_permissions (role_id, permission_key)
SELECT 'support', key FROM (VALUES ('user:list')) AS grants(key)
ON CONFLICT DO NOTHING;
