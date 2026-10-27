INSERT INTO feastjourney.dish_descriptions (dish_id, language_tag, description, summary)
VALUES (:dish_id::bigint, :language_tag::text, :description::text, :summary::nullable(text))
ON CONFLICT (dish_id, language_tag) DO UPDATE SET
  description = EXCLUDED.description,
  summary = EXCLUDED.summary,
  updated_at = now()
RETURNING dish_id, language_tag, description, summary
