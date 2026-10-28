SELECT id::text AS id, job_id::text AS job_id, external_ref, status,
  errors::text AS errors, dish_id::text AS dish_id, payload::text AS payload, created_at
FROM feastjourney.catalog_import_records
WHERE job_id = :job_id::bigint
ORDER BY id ASC
LIMIT :limit::int
