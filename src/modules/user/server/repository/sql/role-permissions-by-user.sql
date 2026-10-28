SELECT DISTINCT rp.permission_key
FROM feastjourney.user_roles AS ur
JOIN feastjourney.role_permissions AS rp ON rp.role_id = ur.role_id
WHERE ur.user_id = :user_id;
