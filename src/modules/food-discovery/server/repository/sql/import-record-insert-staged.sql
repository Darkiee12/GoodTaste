-- Batched stage insert: carries the stable record identity (record_index =
-- original 0-based dataset position, the idempotency key; record_slug =
-- slugged identity for global duplicate scans). UNIQUE (job_id,
-- record_index) makes a retried batch conflict instead of duplicating.
INSERT INTO feastjourney.catalog_import_records
  (job_id, external_ref, status, errors, dish_id, payload, record_index, record_slug)
VALUES
  (:job_id::bigint, :external_ref::text, :status::text, :errors::nullable(jsonb),
    :dish_id::nullable(bigint), :payload::jsonb, :record_index::int, :record_slug::nullable(text))
RETURNING id, job_id, external_ref, status, errors, dish_id, payload::text AS payload,
  record_index, record_slug, created_at
