INSERT INTO feastjourney.catalog_revisions (dish_id, actor, operation, summary)
VALUES (:dish_id::bigint, :actor::text, :operation::text, :summary::text)
RETURNING id, dish_id, actor, operation, summary, created_at
