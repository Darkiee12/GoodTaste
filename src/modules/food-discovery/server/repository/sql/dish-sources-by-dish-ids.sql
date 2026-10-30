SELECT ds.dish_id AS dish_id, r.id AS record_id, p.slug AS provider,
  r.external_id AS external_id, r.canonical_url AS canonical_url,
  r.license AS license, r.attribution AS attribution
FROM feastjourney.dish_sources AS ds
JOIN feastjourney.source_records AS r ON r.id = ds.source_record_id
JOIN feastjourney.source_providers AS p ON p.id = r.provider_id
WHERE ds.dish_id = ANY(:ids::bigint[])
ORDER BY ds.dish_id ASC, r.id ASC
