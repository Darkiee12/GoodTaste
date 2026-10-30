UPDATE feastjourney.dishes
SET status = :status::text
WHERE id = :id::bigint
RETURNING id, slug, parent_dish_id AS "parentDishId", status, created_at AS "createdAt", updated_at AS "updatedAt"
