INSERT INTO feastjourney.role_permissions (role_id, permission_key)
VALUES (:role_id::text, :permission_key::text)
ON CONFLICT DO NOTHING;
