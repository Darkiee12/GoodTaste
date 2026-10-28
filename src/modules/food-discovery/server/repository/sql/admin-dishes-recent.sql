SELECT id::text AS id, slug, status, created_at, updated_at
FROM feastjourney.dishes
ORDER BY updated_at DESC, id DESC
LIMIT :limit::int
