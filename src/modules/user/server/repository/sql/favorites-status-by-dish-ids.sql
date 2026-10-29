SELECT dish_id::text AS dish_id
FROM feastjourney.favorites
WHERE user_id = :user_id
  AND dish_id = ANY(:ids::bigint[])
