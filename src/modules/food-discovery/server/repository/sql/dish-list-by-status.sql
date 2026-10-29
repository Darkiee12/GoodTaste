SELECT id, slug, parent_dish_id AS "parentDishId", status, created_at AS "createdAt", updated_at AS "updatedAt",
  (SELECT n.name
   FROM feastjourney.dish_names AS n
   WHERE n.dish_id = dishes.id
   ORDER BY (n.language_tag = 'en') DESC, n.is_preferred DESC, n.id ASC
   LIMIT 1) AS "displayName"
FROM feastjourney.dishes
WHERE status = :status::text
  AND id > :cursor::bigint
ORDER BY id ASC
LIMIT :limit::int
