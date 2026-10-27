WITH input AS (
  SELECT :updated::timestamptz AS updated
)
SELECT d.id AS id
FROM feastjourney.dishes AS d
CROSS JOIN input
WHERE d.status = :status::text
  AND (
    d.updated_at < input.updated
    OR (d.updated_at = input.updated AND d.id < :cursor::bigint)
  )
ORDER BY d.updated_at DESC, d.id DESC
LIMIT :limit::int
