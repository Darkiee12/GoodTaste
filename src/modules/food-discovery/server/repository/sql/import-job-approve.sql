UPDATE feastjourney.catalog_import_jobs
SET approved_by = :approved_by::text,
  approved_at = :approved_at::timestamptz,
  license_ack = :license_ack::boolean,
  review_ack = :review_ack::boolean,
  acknowledged_duplicates = :acknowledged_duplicates::jsonb
WHERE id = :id::bigint
RETURNING id, approved_by, approved_at, license_ack, review_ack,
  acknowledged_duplicates::text AS acknowledged_duplicates
