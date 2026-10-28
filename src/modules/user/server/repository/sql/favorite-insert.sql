INSERT INTO feastjourney.favorites (user_id, dish_id)
VALUES (:user_id, :dish_id)
RETURNING dish_id, created_at;
