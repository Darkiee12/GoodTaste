SELECT dish_id::text AS dish_id, created_at
FROM feastjourney.favorites
WHERE user_id = :user_id
ORDER BY created_at DESC, dish_id DESC
LIMIT :limit
OFFSET :offset;
