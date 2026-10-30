-- Non-blocking apply guard: same projection as import-job-lock-for-apply,
-- but NOWAIT instead of queuing. A concurrent apply colliding with a live
-- batch fails fast with SQLSTATE 55P03 (mapped to None by the repository,
-- surfaced as a typed conflict naming the running apply) instead of
-- silently serializing behind the winner and double-reporting success.
-- Sequential batches and crash resumes never contend, so they proceed.
SELECT id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, source_url, source_version, license, attribution,
  editorial_notes, approved_by, approved_at, license_ack, review_ack,
  acknowledged_duplicates::text AS acknowledged_duplicates, created_at, completed_at
FROM feastjourney.catalog_import_jobs
WHERE id = :id::bigint
FOR UPDATE NOWAIT
