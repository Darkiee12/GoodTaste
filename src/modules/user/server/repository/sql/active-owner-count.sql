SELECT COUNT(*) AS owner_count
FROM feastjourney.user_roles AS ur
JOIN "feastjourney"."user" AS u ON u.id = ur.user_id
WHERE ur.role_id = 'owner' AND COALESCE(u.banned, false) = false;
