INSERT INTO feastjourney.dish_sources (dish_id, source_record_id)
VALUES (:dish_id::bigint, :source_record_id::bigint)
ON CONFLICT DO NOTHING
