UPDATE feastjourney.catalog_import_records
SET status = :status::text,
  errors = :errors::nullable(jsonb),
  dish_id = :dish_id::nullable(bigint)
WHERE id = :id::bigint
RETURNING id, job_id, external_ref, status, errors, dish_id, payload::text AS payload, created_at
