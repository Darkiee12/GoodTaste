-- Batched stage progress: advances the stage cursor (staged_count) and the
-- frozen validation tallies by exactly one committed batch. The caller holds
-- the job row lock and flips status to validated/failed only on the final
-- batch (staged_count = total_records); intermediate batches keep `staged`.
UPDATE feastjourney.catalog_import_jobs
SET staged_count = :staged_count::int,
  valid_records = :valid_records::int,
  invalid_records = :invalid_records::int,
  status = :status::text,
  completed_at = :completed_at::nullable(timestamptz)
WHERE id = :id::bigint
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, staged_count, applied_count, skipped_count,
  apply_failed_count, created_at, completed_at
