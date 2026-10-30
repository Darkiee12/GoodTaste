-- Bulk editorial review candidates: one row per `review` dish with
-- metadata and provenance flags computed in SQL, so the review UI never
-- needs N+1 reads to show what is missing or questionable.
--
-- Filters: fixed `review` status, keyset cursor, optional import-job scope.
-- A dish links to a job through catalog_import_records.dish_id; when several
-- records point at one dish the newest record wins for provenance display.
-- Validation state (mechanical checklist) is NOT editorial approval: every
-- row still requires an explicit human publish with license/editorial acks.
WITH input AS (
  SELECT :cursor::bigint AS cursor,
    :job_id::nullable(bigint) AS job_id
),
linked AS (
  SELECT DISTINCT ON (r.dish_id) r.dish_id, r.job_id
  FROM feastjourney.catalog_import_records AS r
  CROSS JOIN input
  WHERE r.dish_id IS NOT NULL
    AND (input.job_id IS NULL OR r.job_id = input.job_id)
  ORDER BY r.dish_id, r.id DESC
)
SELECT d.id::text AS id, d.slug, d.status,
  (SELECT n.name
    FROM feastjourney.dish_names AS n
    WHERE n.dish_id = d.id
    ORDER BY (n.language_tag = 'en') DESC, n.is_preferred DESC, n.id ASC
    LIMIT 1) AS display_name,
  linked.job_id::text AS import_job_id,
  job.source_name AS import_source_name,
  job.license AS import_license,
  job.license_ack AS import_license_ack,
  job.review_ack AS import_review_ack,
  EXISTS (
    SELECT 1 FROM feastjourney.dish_names AS n
    WHERE n.dish_id = d.id AND n.language_tag = 'en' AND n.is_preferred
  ) AS has_english_name,
  EXISTS (
    SELECT 1 FROM feastjourney.dish_descriptions AS e
    WHERE e.dish_id = d.id
      AND (char_length(btrim(e.description)) > 0 OR char_length(btrim(COALESCE(e.summary, ''))) > 0)
  ) AS has_description,
  (SELECT COUNT(*)::int FROM feastjourney.dish_ingredients AS i
    WHERE i.dish_id = d.id) AS ingredient_count,
  (SELECT COUNT(*)::int FROM feastjourney.dish_categories AS c
    WHERE c.dish_id = d.id) AS category_count,
  (SELECT COUNT(*)::int FROM feastjourney.dish_places AS p
    WHERE p.dish_id = d.id) AS place_count,
  (SELECT COUNT(*)::int FROM feastjourney.dish_sources AS s
    WHERE s.dish_id = d.id) AS source_count,
  (SELECT COUNT(*)::int FROM feastjourney.curation_notes AS t
    WHERE t.dish_id = d.id) AS note_count,
  (SELECT COUNT(*)::int FROM feastjourney.curation_notes AS t
    WHERE t.dish_id = d.id AND t.note_kind IN ('question', 'correction')) AS open_question_count,
  EXISTS (
    SELECT 1 FROM feastjourney.dish_sources AS s
    JOIN feastjourney.source_records AS r ON r.id = s.source_record_id
    WHERE s.dish_id = d.id AND (r.license IS NULL OR r.license IN ('unknown', 'other'))
  ) AS license_needs_review
FROM feastjourney.dishes AS d
CROSS JOIN input
LEFT JOIN linked ON linked.dish_id = d.id
LEFT JOIN feastjourney.catalog_import_jobs AS job ON job.id = linked.job_id
WHERE d.status = 'review'
  AND d.id > input.cursor
  AND (input.job_id IS NULL OR linked.job_id IS NOT NULL)
ORDER BY d.id ASC
LIMIT :limit::int
