SELECT p.id AS id, p.kind AS kind, p.iso3166 AS iso3166,
  p.display_latitude AS display_latitude, p.display_longitude AS display_longitude,
  n.language_tag AS language_tag, n.name AS name, n.is_preferred AS is_preferred
FROM feastjourney.places AS p
JOIN feastjourney.place_names AS n ON n.place_id = p.id
ORDER BY p.kind ASC, p.id ASC, n.language_tag ASC, n.name ASC
LIMIT :limit::int
