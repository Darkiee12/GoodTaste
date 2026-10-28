SELECT dish_id
FROM feastjourney.favorites
WHERE user_id = :user_id AND dish_id = :dish_id;
