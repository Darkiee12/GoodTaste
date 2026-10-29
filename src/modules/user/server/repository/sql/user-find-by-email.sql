SELECT u.id, u.email, u.name, u.banned, u."createdAt", COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
FROM "feastjourney"."user" AS u
LEFT JOIN feastjourney.user_roles AS ur ON ur.user_id = u.id
WHERE lower(u.email) = lower(:email::text)
GROUP BY u.id
LIMIT 1
