SELECT id
FROM feastjourney.dishes
WHERE id = ANY(:ids::bigint[])
