SELECT id::text AS id, source_name, format, status,
  total_records, valid_records, invalid_records, dry_run,
  source_url, source_version, license, attribution, editorial_notes,
  created_at, completed_at
FROM feastjourney.catalog_import_jobs
WHERE id = :id::bigint
