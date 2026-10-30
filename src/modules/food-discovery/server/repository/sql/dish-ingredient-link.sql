INSERT INTO feastjourney.dish_ingredients (dish_id, ingredient_id, role)
VALUES (:dish_id::bigint, :ingredient_id::bigint, :role::text)
ON CONFLICT DO NOTHING
