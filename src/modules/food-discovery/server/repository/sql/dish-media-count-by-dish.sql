SELECT COUNT(*)::bigint AS count
FROM feastjourney.dish_media
WHERE dish_id = :dish_id::bigint
