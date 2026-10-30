SELECT id, created_at, updated_at
FROM feastjourney.ingredients
WHERE id = :id::bigint
