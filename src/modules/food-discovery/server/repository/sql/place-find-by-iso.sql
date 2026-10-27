SELECT id, kind, iso3166, display_latitude, display_longitude, display_note, created_at, updated_at
FROM feastjourney.places
WHERE iso3166 = :iso::text
