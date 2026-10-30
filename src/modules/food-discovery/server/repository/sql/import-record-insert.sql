INSERT INTO feastjourney.catalog_import_records
  (job_id, external_ref, status, errors, dish_id, payload)
VALUES
  (:job_id::bigint, :external_ref::text, :status::text, :errors::nullable(jsonb),
   :dish_id::nullable(bigint), :payload::jsonb)
RETURNING id, job_id, external_ref, status, errors, dish_id, payload::text AS payload, created_at
