SELECT id, job_id, external_ref, status, errors, dish_id, payload::text AS payload, created_at
FROM feastjourney.catalog_import_records
WHERE job_id = :job_id::bigint
ORDER BY id ASC
LIMIT :limit::int
