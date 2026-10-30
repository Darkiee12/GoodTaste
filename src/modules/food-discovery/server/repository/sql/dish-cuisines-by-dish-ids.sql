SELECT dc.dish_id AS dish_id, dc.cuisine_id AS cuisine_id, c.slug AS slug
FROM feastjourney.dish_cuisines AS dc
JOIN feastjourney.cuisines AS c ON c.id = dc.cuisine_id
WHERE dc.dish_id = ANY(:ids::bigint[])
ORDER BY dc.dish_id ASC, c.slug ASC
