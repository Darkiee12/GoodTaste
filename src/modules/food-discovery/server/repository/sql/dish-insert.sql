INSERT INTO feastjourney.dishes (slug, parent_dish_id, status)
VALUES (:slug::text, :parent_dish_id::nullable(bigint), :status::text)
RETURNING id, slug, parent_dish_id AS "parentDishId", status, created_at AS "createdAt", updated_at AS "updatedAt"
