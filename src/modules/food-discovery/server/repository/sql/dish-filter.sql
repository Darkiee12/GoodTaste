WITH input AS (
  SELECT :ingredient_ids::bigint[] AS ingredient_ids,
    :category_ids::bigint[] AS category_ids,
    :place_ids::bigint[] AS place_ids,
    :ingredient_mode::text AS ingredient_mode,
    :category_mode::text AS category_mode,
    :cuisine::nullable(text) AS cuisine,
    :association::nullable(text) AS association,
    :status::text AS status
)
SELECT d.id AS id
FROM feastjourney.dishes AS d
CROSS JOIN input
WHERE d.status = input.status
  AND d.id > :cursor::bigint
  AND (
    cardinality(input.ingredient_ids) = 0
    OR (
      SELECT count(DISTINCT di.ingredient_id)
      FROM feastjourney.dish_ingredients AS di
      WHERE di.dish_id = d.id AND di.ingredient_id = ANY(input.ingredient_ids)
    ) >= CASE WHEN input.ingredient_mode = 'all' THEN cardinality(input.ingredient_ids) ELSE 1 END
  )
  AND (
    cardinality(input.category_ids) = 0
    OR (
      SELECT count(DISTINCT dc.category_id)
      FROM feastjourney.dish_categories AS dc
      WHERE dc.dish_id = d.id AND dc.category_id = ANY(input.category_ids)
    ) >= CASE WHEN input.category_mode = 'all' THEN cardinality(input.category_ids) ELSE 1 END
  )
  AND (
    cardinality(input.place_ids) = 0
    OR EXISTS (
      SELECT 1
      FROM feastjourney.dish_places AS dp
      WHERE dp.dish_id = d.id
        AND dp.place_id = ANY(input.place_ids)
        AND (input.association IS NULL OR dp.association = input.association)
    )
  )
  AND (
    input.cuisine IS NULL
    OR EXISTS (
      SELECT 1
      FROM feastjourney.dish_cuisines AS dcu
      JOIN feastjourney.cuisines AS c ON c.id = dcu.cuisine_id
      WHERE dcu.dish_id = d.id AND c.slug = input.cuisine
    )
  )
ORDER BY d.id ASC
LIMIT :limit::int
