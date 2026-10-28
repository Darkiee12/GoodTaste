UPDATE feastjourney.catalog_import_jobs
SET status = :status::text,
  valid_records = :valid_records::int,
  invalid_records = :invalid_records::int,
  completed_at = :completed_at::nullable(timestamptz),
  dry_run = COALESCE(:dry_run::nullable(boolean), dry_run)
WHERE id = :id::bigint
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, created_at, completed_at
