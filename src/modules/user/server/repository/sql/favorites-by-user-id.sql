SELECT dish_id, created_at
FROM feastjourney.favorites
WHERE user_id = :user_id
ORDER BY created_at DESC
LIMIT :limit;
