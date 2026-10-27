SELECT id, dish_id, author, note_kind, note, created_at
FROM feastjourney.curation_notes
WHERE dish_id = :dish_id::bigint
ORDER BY created_at DESC, id DESC
LIMIT :limit::int
