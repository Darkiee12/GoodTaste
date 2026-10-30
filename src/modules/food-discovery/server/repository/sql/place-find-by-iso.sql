SELECT id, kind, iso3166, display_latitude AS "displayLatitude", display_longitude AS "displayLongitude", display_note AS "displayNote"
FROM feastjourney.places
WHERE upper(iso3166) = upper(:iso::text)
ORDER BY id ASC
LIMIT 1
