WITH input AS (
  SELECT :q::text AS q, :prefix::text AS prefix, :updated::timestamptz AS updated
)
SELECT d.id AS id
FROM feastjourney.dishes AS d
JOIN (
  SELECT dn.dish_id AS dish_id
  FROM feastjourney.dish_names AS dn
  CROSS JOIN input
  WHERE dn.search_key = input.q
    OR dn.search_key LIKE input.prefix
    OR dn.search_key LIKE :contains::text
  GROUP BY dn.dish_id
) AS matched ON matched.dish_id = d.id
CROSS JOIN input
WHERE d.status = :status::text
  AND (
    d.updated_at < input.updated
    OR (d.updated_at = input.updated AND d.id < :cursor::bigint)
  )
ORDER BY d.updated_at DESC, d.id DESC
LIMIT :limit::int
