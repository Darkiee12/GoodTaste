UPDATE feastjourney.dish_media
SET object_key = :object_key::text,
  processing = :processing::text,
  updated_at = now()
WHERE id = :id::bigint
  AND processing = 'processing'
RETURNING id::text AS id, dish_id::text AS dish_id, object_key,
  public_url, attribution, license, status, sort_order, alt_text,
  focal_x, focal_y,
  original_width, original_height, format, byte_size,
  checksum_sha256, variant_version, uploaded_by, processing,
  reviewed_at, published_at, source_url,
  created_at, updated_at
