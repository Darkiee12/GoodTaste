INSERT INTO feastjourney.catalog_import_jobs
  (source_name, format, status, total_records, valid_records, invalid_records, dry_run,
   source_url, source_version, license, attribution, editorial_notes)
VALUES
  (:source_name::text, :format::text, :status::text, :total_records::int,
   :valid_records::int, :invalid_records::int, :dry_run::boolean,
   :source_url::nullable(text), :source_version::nullable(text), :license::nullable(text),
   :attribution::nullable(text), :editorial_notes::nullable(text))
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, created_at, completed_at
