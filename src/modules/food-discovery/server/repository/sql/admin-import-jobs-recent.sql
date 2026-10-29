SELECT id::text AS id, source_name, format, status,
  total_records, valid_records, invalid_records, dry_run,
  source_url, license, created_at, completed_at
FROM feastjourney.catalog_import_jobs
ORDER BY created_at DESC, id DESC
LIMIT :limit::int
OFFSET :offset::int
