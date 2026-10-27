UPDATE feastjourney.dishes
SET slug = :slug::text,
  parent_dish_id = :parent_dish_id::nullable(bigint),
  status = :status::text
WHERE id = :id::bigint
RETURNING id, slug, parent_dish_id, status, created_at, updated_at
