SELECT status, count(*)::int AS total
FROM feastjourney.catalog_import_jobs
GROUP BY status
ORDER BY status ASC
