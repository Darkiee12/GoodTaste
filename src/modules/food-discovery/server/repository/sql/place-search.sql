WITH input AS (
  SELECT :q::text AS q, :prefix::text AS prefix
)
SELECT p.id AS id, ranked.tier AS tier
FROM feastjourney.places AS p
JOIN (
  SELECT n.place_id AS place_id,
    MIN(
      CASE
        WHEN n.search_key = input.q THEN 0
        WHEN n.search_key LIKE input.prefix THEN 1
        ELSE 2
      END
    ) AS tier
  FROM feastjourney.place_names AS n
  CROSS JOIN input
  WHERE n.search_key = input.q
    OR n.search_key LIKE input.prefix
    OR n.search_key LIKE :contains::text
  GROUP BY n.place_id
) AS ranked ON ranked.place_id = p.id
ORDER BY ranked.tier ASC, p.id ASC
LIMIT :limit::int
