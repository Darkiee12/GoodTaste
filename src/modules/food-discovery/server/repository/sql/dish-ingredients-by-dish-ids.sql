SELECT di.dish_id AS dish_id, di.ingredient_id AS ingredient_id, di.role AS role
FROM feastjourney.dish_ingredients AS di
WHERE di.dish_id = ANY(:ids::bigint[])
ORDER BY di.dish_id ASC, di.ingredient_id ASC
