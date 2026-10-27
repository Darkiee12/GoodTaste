WITH input AS (
  SELECT :q::text AS q, :prefix::text AS prefix, :tier::int AS tier
)
SELECT d.id AS id, ranked.tier AS tier
FROM feastjourney.dishes AS d
JOIN (
  SELECT dn.dish_id AS dish_id,
    MIN(
      CASE
        WHEN dn.search_key = input.q THEN 0
        WHEN dn.search_key LIKE input.prefix THEN 1
        ELSE 2
      END
    ) AS tier
  FROM feastjourney.dish_names AS dn
  CROSS JOIN input
  WHERE dn.search_key = input.q
    OR dn.search_key LIKE input.prefix
    OR dn.search_key LIKE :contains::text
  GROUP BY dn.dish_id
) AS ranked ON ranked.dish_id = d.id
CROSS JOIN input
WHERE d.status = :status::text
  AND (ranked.tier > input.tier OR (ranked.tier = input.tier AND d.id > :cursor::bigint))
ORDER BY ranked.tier ASC, d.id ASC
LIMIT :limit::int
