SELECT dc.dish_id AS dish_id, dc.category_id AS category_id, c.kind AS kind, c.slug AS slug
FROM feastjourney.dish_categories AS dc
JOIN feastjourney.categories AS c ON c.id = dc.category_id
WHERE dc.dish_id = ANY(:ids::bigint[])
ORDER BY dc.dish_id ASC, c.slug ASC
