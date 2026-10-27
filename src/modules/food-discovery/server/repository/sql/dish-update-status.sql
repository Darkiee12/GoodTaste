UPDATE feastjourney.dishes
SET status = :status::text
WHERE id = :id::bigint
RETURNING id, slug, parent_dish_id, status, created_at, updated_at
