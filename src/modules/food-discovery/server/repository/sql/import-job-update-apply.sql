-- Batched apply progress: accumulates per-batch apply outcomes on the job
-- row. valid_records/invalid_records are NEVER rewritten here (they stay
-- frozen at their validation values); apply outcomes live in these counters
-- plus the per-record rows. The caller holds the job row lock and flips
-- status to applied only when no `valid` rows remain.
UPDATE feastjourney.catalog_import_jobs
SET applied_count = :applied_count::int,
  skipped_count = :skipped_count::int,
  apply_failed_count = :apply_failed_count::int,
  status = :status::text,
  completed_at = :completed_at::nullable(timestamptz)
WHERE id = :id::bigint
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, staged_count, applied_count, skipped_count,
  apply_failed_count, created_at, completed_at
