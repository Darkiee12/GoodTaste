UPDATE feastjourney.catalog_import_jobs
SET status = 'applying',
  dry_run = FALSE
WHERE id = :id::bigint
  AND status IN ('validated', 'applying')
RETURNING id, source_name, format, status, total_records, valid_records,
  invalid_records, dry_run, source_url, source_version, license, attribution,
  editorial_notes, approved_by, approved_at, license_ack, review_ack,
  acknowledged_duplicates::text AS acknowledged_duplicates, created_at, completed_at
