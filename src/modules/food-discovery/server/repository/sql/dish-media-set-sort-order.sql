UPDATE feastjourney.dish_media
SET sort_order = :sort_order::integer,
  updated_at = now()
WHERE id = :id::bigint
RETURNING id::text AS id, dish_id::text AS dish_id, sort_order
