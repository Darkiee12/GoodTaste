SELECT id, slug, parent_dish_id AS "parentDishId", status, created_at AS "createdAt", updated_at AS "updatedAt"
FROM feastjourney.dishes
WHERE id = :id::bigint
