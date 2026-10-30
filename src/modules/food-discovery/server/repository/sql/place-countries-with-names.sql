-- Country registry listing: one entry per country-kind place with a
-- verified ISO code, with all of its names for locale fallback. The limit
-- counts DISTINCT COUNTRIES, not joined name rows (a country carries
-- several names — English, Vietnamese, aliases — and a row-level limit
-- would silently drop most of the world from the chooser). Ordering stays
-- insertion order (place id) so pagination is deterministic.
WITH scoped AS (
  SELECT p2.id AS id
  FROM feastjourney.places AS p2
  WHERE p2.kind = 'country'
    AND p2.iso3166 IS NOT NULL
  ORDER BY p2.id ASC
  LIMIT :limit::int
)
SELECT p.id AS id, p.kind AS kind, p.iso3166 AS iso3166,
  p.display_latitude AS display_latitude, p.display_longitude AS display_longitude,
  n.language_tag AS language_tag, n.name AS name, n.is_preferred AS is_preferred
FROM feastjourney.places AS p
JOIN scoped AS s ON s.id = p.id
JOIN feastjourney.place_names AS n ON n.place_id = p.id
ORDER BY p.id ASC, n.language_tag ASC, n.name ASC
