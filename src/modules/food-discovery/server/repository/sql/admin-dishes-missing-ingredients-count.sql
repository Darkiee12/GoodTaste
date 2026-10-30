SELECT count(*)::int AS total
FROM feastjourney.dishes AS d
WHERE NOT EXISTS (
  SELECT 1
  FROM feastjourney.dish_ingredients AS di
  WHERE di.dish_id = d.id
)
