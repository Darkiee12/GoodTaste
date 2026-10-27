SELECT id, slug, parent_dish_id, status, created_at, updated_at
FROM feastjourney.dishes
WHERE id = :id::bigint
