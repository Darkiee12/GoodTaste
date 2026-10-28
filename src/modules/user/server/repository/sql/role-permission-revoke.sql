DELETE FROM feastjourney.role_permissions
WHERE role_id = :role_id AND permission_key = :permission_key;
