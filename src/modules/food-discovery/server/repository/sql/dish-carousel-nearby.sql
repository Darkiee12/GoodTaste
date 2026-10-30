-- Carousel nearby selection: published dishes tied to locality-kind places
-- inside a caller-chosen PostGIS geography radius. Country, region, and
-- continent centroids NEVER count as nearby (kind filter): only city-scale
-- placements do, so a country centroid 400 km away cannot relabel another
-- region's dishes as "near you".
--
-- Geographic relevance is enforced by the service, not this query: it walks
-- a bounded radius schedule (metro first, then the documented cap) and keeps
-- the first non-empty band, so ordering here only ever rotates within the
-- tightest band that actually has dishes. Same seeded score + per-cuisine
-- diversity shaping as the other carousel queries.
--
-- Cost/index note: display_latitude/longitude are plain float columns (no
-- geometry column exists — adding one is a migration outside this change),
-- so each attempt is a sequential scan with an ST_DWithin geography
-- predicate, exactly like dish-recommendation-candidates-nearby.sql. The
-- places table holds dozens of rows and kind = 'locality' narrows it
-- further; the dish join rides dish_places_place_idx. Revisit if places
-- grows past easy sequential-scan size; the ST_DWithin-on-geography shape
-- is already GiST-ready for a future generated column.
WITH input AS (
  SELECT :latitude::float8 AS lat,
    :longitude::float8 AS lon,
    :radius_m::int AS radius_m,
    :seed::int AS seed
),
nearby_places AS (
  SELECT p.id AS place_id,
    ST_Distance(
      ST_MakePoint(p.display_longitude, p.display_latitude)::geography,
      ST_MakePoint(input.lon, input.lat)::geography
    ) AS dist_m
  FROM feastjourney.places AS p
  CROSS JOIN input
  WHERE p.display_latitude IS NOT NULL
    AND p.display_longitude IS NOT NULL
    AND p.kind = 'locality'
    AND ST_DWithin(
      ST_MakePoint(p.display_longitude, p.display_latitude)::geography,
      ST_MakePoint(input.lon, input.lat)::geography,
      input.radius_m
    )
),
ranked AS (
  SELECT dp.dish_id AS dish_id,
    MIN(
      CASE dp.association
        WHEN 'origin' THEN 0
        WHEN 'associated' THEN 1
        ELSE 2
      END
    ) AS assoc_rank,
    MIN(nearby_places.dist_m) AS dist_m
  FROM feastjourney.dish_places AS dp
  JOIN nearby_places ON nearby_places.place_id = dp.place_id
  GROUP BY dp.dish_id
),
candidates AS (
  SELECT d.id AS dish_id,
    d.slug AS slug,
    ranked.assoc_rank AS assoc_rank,
    EXISTS (
      SELECT 1
      FROM feastjourney.dish_media AS m
      WHERE m.dish_id = d.id AND m.status = 'published' AND m.processing = 'ready'
    ) AS has_photo,
    (
      SELECT c.slug
      FROM feastjourney.dish_cuisines AS dc
      JOIN feastjourney.cuisines AS c ON c.id = dc.cuisine_id
      WHERE dc.dish_id = d.id
      ORDER BY c.slug ASC
      LIMIT 1
    ) AS cuisine
  FROM feastjourney.dishes AS d
  JOIN ranked ON ranked.dish_id = d.id
  WHERE d.status = 'published'
),
scored AS (
  SELECT dish_id,
    (
      ((hashtext(candidates.slug || ':' || (SELECT seed::text FROM input)) % 100) + 100) % 100
      + candidates.assoc_rank * 15
      + CASE WHEN candidates.has_photo THEN 0 ELSE 60 END
    ) AS score,
    candidates.cuisine AS cuisine
  FROM candidates
),
numbered AS (
  SELECT dish_id,
    score,
    ROW_NUMBER() OVER (PARTITION BY cuisine ORDER BY score ASC, dish_id ASC) AS cuisine_rn
  FROM scored
)
SELECT numbered.dish_id AS id
FROM numbered
ORDER BY numbered.cuisine_rn ASC, numbered.score ASC, numbered.dish_id ASC
LIMIT :limit::int
