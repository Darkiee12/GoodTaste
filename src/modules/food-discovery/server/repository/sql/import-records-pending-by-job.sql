-- Next pending apply window: only `valid` rows are ever picked up, in
-- original dataset order. Applied/skipped/failed rows are never replayed,
-- so a crashed or timed-out apply batch resumes exactly where it stopped.
-- Bounded by LIMIT: the caller drives the cursor forward call by call.
SELECT id, job_id, external_ref, status, errors, dish_id, payload::text AS payload,
  record_index, record_slug
FROM feastjourney.catalog_import_records
WHERE job_id = :job_id::bigint
  AND status = 'valid'
ORDER BY record_index ASC NULLS LAST, id ASC
LIMIT :limit::int
