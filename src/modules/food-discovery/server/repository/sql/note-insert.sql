INSERT INTO feastjourney.curation_notes (dish_id, author, note_kind, note)
VALUES (:dish_id::bigint, :author::text, :note_kind::text, :note::text)
RETURNING id, dish_id, author, note_kind, note, created_at
