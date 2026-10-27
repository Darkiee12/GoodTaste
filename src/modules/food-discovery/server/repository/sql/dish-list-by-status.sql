SELECT id, slug, parent_dish_id, status, created_at, updated_at
FROM feastjourney.dishes
WHERE status = :status::text
  AND id > :cursor::bigint
ORDER BY id ASC
LIMIT :limit::int
