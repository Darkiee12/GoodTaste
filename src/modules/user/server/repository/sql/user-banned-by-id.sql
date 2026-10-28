SELECT COALESCE(banned, false) AS banned
FROM "feastjourney"."user"
WHERE id = :user_id;
