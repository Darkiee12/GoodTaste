INSERT INTO feastjourney.source_records
  (provider_id, external_id, canonical_url, retrieved_at, revision, license, attribution, import_status, payload)
VALUES
  (:provider_id::bigint, :external_id::text, :canonical_url::nullable(text),
   :retrieved_at::timestamptz, :revision::nullable(text), :license::nullable(text),
   :attribution::nullable(text), :import_status::text, :payload::nullable(jsonb))
ON CONFLICT (provider_id, external_id) DO UPDATE SET
  canonical_url = EXCLUDED.canonical_url,
  retrieved_at = EXCLUDED.retrieved_at,
  revision = EXCLUDED.revision,
  license = EXCLUDED.license,
  attribution = EXCLUDED.attribution,
  import_status = EXCLUDED.import_status,
  payload = EXCLUDED.payload
RETURNING id, provider_id, external_id, import_status
