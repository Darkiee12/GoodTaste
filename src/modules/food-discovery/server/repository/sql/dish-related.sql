WITH input AS (
  SELECT :id::bigint AS id, :status::text AS status
)
SELECT d.id AS id,
  (
    (
      SELECT count(*)
      FROM feastjourney.dish_categories AS dc1
      JOIN feastjourney.dish_categories AS dc2 ON dc2.category_id = dc1.category_id
      WHERE dc1.dish_id = input.id AND dc2.dish_id = d.id
    ) + (
      SELECT count(*)
      FROM feastjourney.dish_cuisines AS dcu1
      JOIN feastjourney.dish_cuisines AS dcu2 ON dcu2.cuisine_id = dcu1.cuisine_id
      WHERE dcu1.dish_id = input.id AND dcu2.dish_id = d.id
    ) + (
      SELECT count(*)
      FROM feastjourney.dish_places AS dp1
      JOIN feastjourney.dish_places AS dp2 ON dp2.place_id = dp1.place_id
      WHERE dp1.dish_id = input.id AND dp2.dish_id = d.id
    ) + (
      SELECT count(*)
      FROM feastjourney.dish_ingredients AS di1
      JOIN feastjourney.dish_ingredients AS di2 ON di2.ingredient_id = di1.ingredient_id
      WHERE di1.dish_id = input.id AND di2.dish_id = d.id
    )
  )::int AS shared
FROM feastjourney.dishes AS d
CROSS JOIN input
WHERE d.id <> input.id AND d.status = input.status
ORDER BY shared DESC, d.id ASC
LIMIT :limit::int
