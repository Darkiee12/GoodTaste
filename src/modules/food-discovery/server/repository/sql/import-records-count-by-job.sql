-- Per-status tallies for one job: drives the paginated Issues UI (total
-- pages, invalid count) without fetching rows. Includes the legacy NULL
-- record_index rows: counts are by status only.
SELECT status, COUNT(*)::int AS total
FROM feastjourney.catalog_import_records
WHERE job_id = :job_id::bigint
GROUP BY status
