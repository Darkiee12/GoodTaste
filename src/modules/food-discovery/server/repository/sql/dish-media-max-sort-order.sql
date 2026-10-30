SELECT COALESCE(MAX(sort_order), -1)::integer AS max_sort_order
FROM feastjourney.dish_media
WHERE dish_id = :dish_id::bigint
