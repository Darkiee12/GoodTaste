SELECT dish_id
FROM feastjourney.dish_names
WHERE search_key = :key::text
LIMIT :limit::int
