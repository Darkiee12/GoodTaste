-- Global duplicate preflight across batches: every slugged identity already
-- staged for this job in one indexed scan. The service compares each new
-- batch against this persisted set (plus the live catalog), so detection
-- spans the whole dataset without loading every stored payload at once.
SELECT external_ref, record_slug, record_index
FROM feastjourney.catalog_import_records
WHERE job_id = :job_id::bigint
  AND record_slug IS NOT NULL
ORDER BY record_index ASC NULLS LAST, id ASC
