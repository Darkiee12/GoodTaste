WITH RECURSIVE input AS (
  SELECT :association::nullable(text) AS association
),
tree(id) AS (
  SELECT :place_id::bigint AS id
  UNION
  SELECT pp.place_id AS id
  FROM feastjourney.place_parents AS pp
  JOIN tree AS t ON t.id = pp.parent_place_id
)
SELECT DISTINCT dp.dish_id AS dish_id
FROM feastjourney.dish_places AS dp
JOIN tree AS t ON t.id = dp.place_id
JOIN feastjourney.dishes AS d ON d.id = dp.dish_id
CROSS JOIN input
WHERE d.status = :status::text
  AND (input.association IS NULL OR dp.association = input.association)
ORDER BY dp.dish_id ASC
LIMIT :limit::int
