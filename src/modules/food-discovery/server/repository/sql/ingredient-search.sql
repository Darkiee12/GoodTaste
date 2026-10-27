WITH input AS (
  SELECT :q::text AS q, :prefix::text AS prefix
)
SELECT i.id AS id, ranked.tier AS tier
FROM feastjourney.ingredients AS i
JOIN (
  SELECT n.ingredient_id AS ingredient_id,
    MIN(
      CASE
        WHEN n.search_key = input.q THEN 0
        WHEN n.search_key LIKE input.prefix THEN 1
        ELSE 2
      END
    ) AS tier
  FROM feastjourney.ingredient_names AS n
  CROSS JOIN input
  WHERE n.search_key = input.q
    OR n.search_key LIKE input.prefix
    OR n.search_key LIKE :contains::text
  GROUP BY n.ingredient_id
) AS ranked ON ranked.ingredient_id = i.id
ORDER BY ranked.tier ASC, i.id ASC
LIMIT :limit::int
