INSERT INTO feastjourney.dish_places (dish_id, place_id, association, is_disputed, note)
VALUES (:dish_id::bigint, :place_id::bigint, :association::text, :is_disputed::boolean, :note::nullable(text))
ON CONFLICT DO NOTHING
