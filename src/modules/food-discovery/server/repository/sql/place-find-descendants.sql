WITH RECURSIVE tree(id) AS (
  SELECT :id::bigint AS id
  UNION
  SELECT pp.place_id AS id
  FROM feastjourney.place_parents AS pp
  JOIN tree AS t ON t.id = pp.parent_place_id
)
SELECT p.id AS id, p.kind AS kind, p.iso3166 AS iso3166,
  p.display_latitude AS "displayLatitude", p.display_longitude AS "displayLongitude",
  p.display_note AS "displayNote"
FROM feastjourney.places AS p
JOIN tree AS t ON t.id = p.id
ORDER BY p.id ASC
