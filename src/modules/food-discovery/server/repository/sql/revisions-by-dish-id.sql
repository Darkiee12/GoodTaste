SELECT id, dish_id, actor, operation, summary, created_at
FROM feastjourney.catalog_revisions
WHERE dish_id = :dish_id::bigint
ORDER BY created_at DESC, id DESC
LIMIT :limit::int
