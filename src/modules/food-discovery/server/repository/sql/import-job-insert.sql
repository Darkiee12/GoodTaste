INSERT INTO feastjourney.catalog_import_jobs
  (source_name, format, status, total_records, valid_records, invalid_records, dry_run)
VALUES
  (:source_name::text, :format::text, :status::text, :total_records::int,
   :valid_records::int, :invalid_records::int, :dry_run::boolean)
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, created_at, completed_at
