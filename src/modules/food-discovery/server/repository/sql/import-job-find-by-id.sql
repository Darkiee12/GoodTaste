SELECT id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, created_at, completed_at
FROM feastjourney.catalog_import_jobs
WHERE id = :id::bigint
