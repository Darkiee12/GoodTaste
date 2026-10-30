SELECT m.id::text AS id, m.dish_id::text AS dish_id, m.object_key AS object_key,
  m.public_url AS public_url, m.attribution AS attribution, m.license AS license,
  m.status AS status, m.sort_order AS sort_order, m.alt_text AS alt_text,
  m.focal_x AS focal_x, m.focal_y AS focal_y,
  m.original_width AS original_width, m.original_height AS original_height,
  m.format AS format, m.byte_size AS byte_size,
  m.checksum_sha256 AS checksum_sha256, m.variant_version AS variant_version,
  m.uploaded_by AS uploaded_by, m.processing AS processing,
  m.reviewed_at AS reviewed_at, m.published_at AS published_at,
  m.source_url AS source_url,
  m.created_at AS created_at, m.updated_at AS updated_at
FROM feastjourney.dish_media AS m
WHERE m.dish_id = ANY(:ids::bigint[])
  AND m.status = 'published'
  AND m.processing = 'ready'
ORDER BY m.dish_id ASC, m.sort_order ASC, m.id ASC
