SELECT ingredient_id, language_tag, name
FROM feastjourney.ingredient_names
WHERE search_key = :key::text AND language_tag = :language_tag::text
LIMIT :limit::int
