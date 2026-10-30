-- Paginated issue/record retrieval for large jobs: keyset on the record id
-- with an optional status filter, so the Issues review never loads the whole
-- staged set at once. Totals come from import-records-count-by-job.
WITH input AS (
  SELECT :cursor::bigint AS cursor_id,
    :status::nullable(text) AS status_filter
)
SELECT r.id::text AS id, r.job_id::text AS job_id, r.external_ref, r.status,
  r.errors::text AS errors, r.dish_id::text AS dish_id,
  r.payload::text AS payload, r.record_index, r.record_slug, r.created_at
FROM feastjourney.catalog_import_records AS r
CROSS JOIN input
WHERE r.job_id = :job_id::bigint
  AND r.id > input.cursor_id
  AND (input.status_filter IS NULL OR r.status = input.status_filter)
ORDER BY r.id ASC
LIMIT :limit::int
