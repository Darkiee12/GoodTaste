SELECT p.id AS id,
  p.display_latitude AS display_latitude, p.display_longitude AS display_longitude
FROM feastjourney.places AS p
WHERE p.display_latitude IS NOT NULL AND p.display_longitude IS NOT NULL
ORDER BY p.id ASC
