DELETE FROM feastjourney.dish_media
WHERE id = :id::bigint
RETURNING id::text AS id, dish_id::text AS dish_id, object_key, variant_version
