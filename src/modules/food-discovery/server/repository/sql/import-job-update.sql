-- Counter semantics: valid_records/invalid_records always hold the
-- validation outcome (so total = valid + invalid for the dashboard, and
-- valid >= applied). Apply outcomes live on catalog_import_records rows
-- (applied/skipped_duplicate/invalid) and in the apply report, never here;
-- the apply path rewrites the frozen validation counts unchanged.
UPDATE feastjourney.catalog_import_jobs
SET status = :status::text,
  valid_records = :valid_records::int,
  invalid_records = :invalid_records::int,
  completed_at = :completed_at::nullable(timestamptz),
  dry_run = COALESCE(:dry_run::nullable(boolean), dry_run)
WHERE id = :id::bigint
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, created_at, completed_at
