SELECT id, kind, iso3166, display_latitude AS "displayLatitude", display_longitude AS "displayLongitude", display_note AS "displayNote"
FROM feastjourney.places
WHERE id = :id::bigint
