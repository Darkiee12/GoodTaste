SELECT m.id AS id, m.dish_id AS dish_id, m.object_key AS object_key,
  m.public_url AS public_url, m.attribution AS attribution, m.license AS license,
  m.sort_order AS sort_order, m.alt_text AS alt_text,
  m.focal_x AS focal_x, m.focal_y AS focal_y
FROM feastjourney.dish_media AS m
WHERE m.dish_id = ANY(:ids::bigint[])
  AND m.status = :status::text
ORDER BY m.dish_id ASC, m.sort_order ASC, m.id ASC
