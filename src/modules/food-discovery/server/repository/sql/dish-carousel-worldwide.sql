-- Carousel worldwide selection: published dishes across the whole catalog,
-- ordered for seeded rotation with soft image/diversity shaping. Same scoring
-- contract as dish-carousel-country.sql minus the association term (there is
-- no scope to be relevant to here). Never oldest-first, never
-- ORDER BY random().
--
-- Cost: one bounded pass over published dishes (tens of thousands of rows):
-- per-row EXISTS rides dish_media_dish_idx, the cuisine lookup rides
-- dish_cuisines_cuisine_idx, then a single sort of the scored rows with
-- LIMIT 5. No full-table random scan; the sort key is computed, not random.
WITH input AS (
  SELECT :seed::int AS seed
),
candidates AS (
  SELECT d.id AS dish_id,
    d.slug AS slug,
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
  WHERE d.status = 'published'
),
scored AS (
  SELECT dish_id,
    (
      ((hashtext(candidates.slug || ':' || (SELECT seed::text FROM input)) % 100) + 100) % 100
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
