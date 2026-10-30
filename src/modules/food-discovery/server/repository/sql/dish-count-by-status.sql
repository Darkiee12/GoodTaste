SELECT count(*)::int AS total
FROM feastjourney.dishes
WHERE status = :status::text
