-- Carousel country selection: published dishes associated with a country
-- subtree, ordered for seeded rotation with soft relevance/image/diversity
-- shaping. Never oldest-first, never ORDER BY random().
--
-- Score (lower wins):
--   u .......... uniform 0..99 draw from hashtext(slug || seed): the rotation
--                engine. Same seed -> same order (stable within a session,
--                deterministic); a new seed ("another set") -> a new order.
--                Integer-math only: ((x % 100) + 100) % 100 stays correct for
--                negative hashes including INT_MIN (no abs() overflow).
--   assoc * 15 . soft geographic-relevance shaping: origin (0) sorts ahead
--                of associated (1) / popular (2) without freezing lower tiers
--                out of large pools.
--   photo + 60 . soft imagery preference: dishes with a published + ready
--                delivery image sort ahead, but photo-less dishes still
--                surface whenever their draw wins.
-- Diversity: ROW_NUMBER partitioned by primary cuisine (first slug
-- alphabetically; dishes without a cuisine share one partition) emits one
-- dish per cuisine first, then seconds — the five-card window spans cuisines
-- instead of collapsing to one.
--
-- Cost: candidates are the country subtree's dishes (small); EXISTS and the
-- cuisine lookup ride dish_media_dish_idx / dish_cuisines_cuisine_idx. The
-- caller passes one country place id; subtree expansion is a recursive CTE
-- over place_parents (same shape as place-find-dish-ids.sql).
WITH RECURSIVE input AS (
  SELECT :place_id::bigint AS place_id,
    :seed::int AS seed
),
tree(id) AS (
  SELECT input.place_id
  FROM input
  UNION
  SELECT pp.place_id
  FROM feastjourney.place_parents AS pp
  JOIN tree AS t ON t.id = pp.parent_place_id
),
ranked AS (
  SELECT dp.dish_id AS dish_id,
    MIN(
      CASE dp.association
        WHEN 'origin' THEN 0
        WHEN 'associated' THEN 1
        ELSE 2
      END
    ) AS assoc_rank
  FROM feastjourney.dish_places AS dp
  JOIN tree AS t ON t.id = dp.place_id
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
