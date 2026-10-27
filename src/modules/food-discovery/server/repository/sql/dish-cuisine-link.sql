INSERT INTO feastjourney.dish_cuisines (dish_id, cuisine_id)
VALUES (:dish_id::bigint, :cuisine_id::bigint)
ON CONFLICT DO NOTHING
