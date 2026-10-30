INSERT INTO feastjourney.dish_categories (dish_id, category_id)
VALUES (:dish_id::bigint, :category_id::bigint)
ON CONFLICT DO NOTHING
