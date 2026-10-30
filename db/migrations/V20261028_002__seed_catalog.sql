-- FeastJourney canonical seed: categories, cuisines, places, ingredients, dishes.
-- Source-backed where noted; contested heritage claims marked disputed/review, never
-- presented as definitive. Display coordinates are cartographic placements, not
-- birthplace claims. Native scripts preserved; search_key is a normalized lookup
-- aid (lowercase ASCII fold where applicable), not a display value.

SET search_path TO feastjourney, public;

-- ------------------------------------------------------- source providers ---
INSERT INTO feastjourney.source_providers (slug, name, homepage_url) VALUES
  ('wikidata', 'Wikidata', 'https://www.wikidata.org/'),
  ('wikipedia', 'Wikipedia', 'https://www.wikipedia.org/'),
  ('curated', 'FeastJourney curated seed', NULL)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------- categories ---
INSERT INTO feastjourney.categories (kind, slug) VALUES
  ('meal_occasion', 'breakfast'), ('meal_occasion', 'lunch'),
  ('meal_occasion', 'dinner'), ('meal_occasion', 'snack'),
  ('dish_type', 'soup'), ('dish_type', 'noodles'), ('dish_type', 'rice-dish'),
  ('dish_type', 'sandwich'), ('dish_type', 'pastry'), ('dish_type', 'beverage'),
  ('dish_type', 'other'),
  ('course', 'appetizer'), ('course', 'main-course'),
  ('course', 'dessert'), ('course', 'side-dish'),
  ('serving_style', 'street-food'), ('serving_style', 'shared-platter')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO feastjourney.category_names (category_id, language_tag, name, is_preferred)
SELECT c.id, 'en', n.name, TRUE
FROM feastjourney.categories c
JOIN (VALUES
  ('breakfast', 'Breakfast'), ('lunch', 'Lunch'), ('dinner', 'Dinner'), ('snack', 'Snack'),
  ('soup', 'Soup'), ('noodles', 'Noodles'), ('rice-dish', 'Rice dish'),
  ('sandwich', 'Sandwich'), ('pastry', 'Pastry'), ('beverage', 'Beverage'),
  ('other', 'Other'), ('appetizer', 'Appetizer'), ('main-course', 'Main course'),
  ('dessert', 'Dessert'), ('side-dish', 'Side dish'),
  ('street-food', 'Street food'), ('shared-platter', 'Shared platter')
) AS n(slug, name) ON n.slug = c.slug
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------- cuisines ---
INSERT INTO feastjourney.cuisines (slug, wikidata_id) VALUES
  ('vietnamese', NULL), ('japanese', NULL), ('korean', NULL), ('italian', NULL),
  ('spanish', NULL), ('mexican', NULL), ('nigerian', NULL), ('ethiopian', NULL),
  ('indian', NULL), ('levantine', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO feastjourney.cuisine_names (cuisine_id, language_tag, name, is_preferred, search_key)
SELECT c.id, 'en', n.name, TRUE, lower(n.name)
FROM feastjourney.cuisines c
JOIN (VALUES
  ('vietnamese', 'Vietnamese'), ('japanese', 'Japanese'), ('korean', 'Korean'),
  ('italian', 'Italian'), ('spanish', 'Spanish'), ('mexican', 'Mexican'),
  ('nigerian', 'Nigerian'), ('ethiopian', 'Ethiopian'), ('indian', 'Indian'),
  ('levantine', 'Levantine')
) AS n(slug, name) ON n.slug = c.slug
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------- places ---
INSERT INTO feastjourney.places (kind, wikidata_id, iso3166, display_latitude, display_longitude, display_note) VALUES
  ('continent', NULL, NULL, 34.0, 100.0, 'Cartographic placement for Asia; not a dish origin claim.'),
  ('continent', NULL, NULL, 54.0, 15.0, 'Cartographic placement for Europe; not a dish origin claim.'),
  ('continent', NULL, NULL, 7.0, 21.0, 'Cartographic placement for Africa; not a dish origin claim.'),
  ('continent', NULL, NULL, 37.0, -95.0, 'Cartographic placement for North America; not a dish origin claim.'),
  ('region', NULL, NULL, 12.0, 105.0, 'Cartographic placement for Southeast Asia.'),
  ('region', NULL, NULL, 36.0, 138.0, 'Cartographic placement for East Asia.'),
  ('region', NULL, NULL, 20.0, 78.0, 'Cartographic placement for South Asia.'),
  ('region', NULL, NULL, 41.0, -4.0, 'Cartographic placement for Southern Europe.'),
  ('region', NULL, NULL, 9.0, 2.0, 'Cartographic placement for West Africa.'),
  ('country', 'Q881', 'VN', 14.0583, 108.2772, 'Country centroid for map display; not a birthplace claim.'),
  ('country', 'Q17', 'JP', 36.2048, 138.2529, 'Country centroid for map display.'),
  ('country', 'Q884', 'KR', 35.9078, 127.7669, 'Country centroid for map display.'),
  ('country', 'Q38', 'IT', 41.8719, 12.5674, 'Country centroid for map display.'),
  ('country', 'Q29', 'ES', 40.4637, -3.7492, 'Country centroid for map display.'),
  ('country', 'Q96', 'MX', 23.6345, -102.5528, 'Country centroid for map display.'),
  ('country', 'Q1033', 'NG', 9.082, 8.6753, 'Country centroid for map display.'),
  ('country', 'Q115', 'ET', 9.145, 40.4897, 'Country centroid for map display.'),
  ('country', 'Q668', 'IN', 20.5937, 78.9629, 'Country centroid for map display.'),
  ('locality', NULL, NULL, 21.0278, 105.8342, 'Hanoi city placement.'),
  ('locality', NULL, NULL, 35.6762, 139.6503, 'Tokyo city placement.'),
  ('locality', NULL, NULL, 41.3851, 2.1734, 'Barcelona city placement.')
ON CONFLICT DO NOTHING;

-- Name the seeded places (ids resolved by iso or kind+coordinates to stay idempotent).
INSERT INTO feastjourney.place_names (place_id, language_tag, name, is_preferred, search_key)
SELECT p.id, 'en', n.name, TRUE, lower(n.name)
FROM feastjourney.places p
JOIN (VALUES
  ('continent', 34.0, 100.0, NULL, 'Asia'), ('continent', 54.0, 15.0, NULL, 'Europe'),
  ('continent', 7.0, 21.0, NULL, 'Africa'), ('continent', 37.0, -95.0, NULL, 'North America'),
  ('region', 12.0, 105.0, NULL, 'Southeast Asia'), ('region', 36.0, 138.0, NULL, 'East Asia'),
  ('region', 20.0, 78.0, NULL, 'South Asia'), ('region', 41.0, -4.0, NULL, 'Southern Europe'),
  ('region', 9.0, 2.0, NULL, 'West Africa'),
  ('country', NULL, NULL, 'VN', 'Vietnam'), ('country', NULL, NULL, 'JP', 'Japan'),
  ('country', NULL, NULL, 'KR', 'South Korea'), ('country', NULL, NULL, 'IT', 'Italy'),
  ('country', NULL, NULL, 'ES', 'Spain'), ('country', NULL, NULL, 'MX', 'Mexico'),
  ('country', NULL, NULL, 'NG', 'Nigeria'), ('country', NULL, NULL, 'ET', 'Ethiopia'),
  ('country', NULL, NULL, 'IN', 'India'),
  ('locality', 21.0278, 105.8342, NULL, 'Hanoi'), ('locality', 35.6762, 139.6503, NULL, 'Tokyo'),
  ('locality', 41.3851, 2.1734, NULL, 'Barcelona')
) AS n(kind, lat, lon, iso, name)
  ON (
    (n.iso IS NOT NULL AND p.iso3166 = n.iso)
    OR (n.iso IS NULL AND p.kind = n.kind
        AND p.display_latitude = n.lat AND p.display_longitude = n.lon)
  )
WHERE NOT EXISTS (
  SELECT 1 FROM feastjourney.place_names e
  WHERE e.place_id = p.id AND e.language_tag = 'en' AND e.name = n.name
);

-- Hierarchy: countries -> regions -> continents; cities -> countries.
INSERT INTO feastjourney.place_parents (place_id, parent_place_id)
SELECT child.id, parent.id
FROM (VALUES
  ('VN', 'Southeast Asia'), ('JP', 'East Asia'), ('KR', 'East Asia'), ('IN', 'South Asia'),
  ('IT', 'Southern Europe'), ('ES', 'Southern Europe'),
  ('NG', 'West Africa'), ('ET', 'West Africa')
) AS m(iso, parent_en)
JOIN feastjourney.places child ON child.iso3166 = m.iso
JOIN LATERAL (
  SELECT pn.place_id AS id FROM feastjourney.place_names pn
  WHERE pn.name = m.parent_en AND pn.is_preferred AND pn.language_tag = 'en'
  LIMIT 1
) AS parent ON TRUE
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.place_parents (place_id, parent_place_id)
SELECT child.id, parent.id
FROM (VALUES ('Hanoi', 'VN'), ('Tokyo', 'JP'), ('Barcelona', 'ES')) AS m(city, iso)
JOIN feastjourney.place_names cpn ON cpn.name = m.city AND cpn.is_preferred
JOIN feastjourney.places child ON child.id = cpn.place_id
JOIN feastjourney.places parent ON parent.iso3166 = m.iso
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------ ingredients ---
INSERT INTO feastjourney.ingredients (wikidata_id) VALUES
  ('Q11004'), ('Q750579'), ('Q10946864'), ('Q15095252'), ('Q9058513'),
  (NULL), (NULL), (NULL), (NULL), (NULL),
  (NULL), (NULL), (NULL), (NULL), (NULL),
  (NULL), (NULL), (NULL), (NULL), (NULL)
ON CONFLICT DO NOTHING;

-- Idempotent ingredient seeding via stable insertion order:
-- (rely on names table being empty on first seed; guard reruns with name check).
INSERT INTO feastjourney.ingredient_names (ingredient_id, language_tag, name, name_kind, is_preferred, search_key)
SELECT i.id, v.language_tag, v.name, v.name_kind, v.is_preferred, v.search_key
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.ingredients) i
JOIN (VALUES
  (1, 'en', 'rice noodles', 'native', TRUE, 'rice noodles'),
  (2, 'en', 'beef', 'localized', TRUE, 'beef'),
  (3, 'en', 'cilantro', 'localized', TRUE, 'cilantro'),
  (3, 'en', 'coriander leaves', 'alias', FALSE, 'coriander leaves'),
  (3, 'vi', 'rau mùi', 'native', TRUE, 'rau mui'),
  (4, 'en', 'fish sauce', 'localized', TRUE, 'fish sauce'),
  (4, 'vi', 'nước mắm', 'native', TRUE, 'nuoc mam'),
  (5, 'en', 'baguette', 'localized', TRUE, 'baguette'),
  (6, 'en', 'pork', 'localized', TRUE, 'pork'),
  (7, 'en', 'pickled vegetables', 'localized', TRUE, 'pickled vegetables'),
  (8, 'en', 'raw fish', 'localized', TRUE, 'raw fish'),
  (8, 'ja', '刺身', 'native', TRUE, '刺身'),
  (9, 'en', 'sushi rice', 'localized', TRUE, 'sushi rice'),
  (10, 'en', 'nori', 'localized', TRUE, 'nori'),
  (10, 'ja', '海苔', 'native', TRUE, '海苔'),
  (11, 'en', 'ramen noodles', 'localized', TRUE, 'ramen noodles'),
  (11, 'ja', 'ラーメン', 'native', TRUE, 'ラーメン'),
  (12, 'en', 'pork broth', 'localized', TRUE, 'pork broth'),
  (13, 'en', 'egg', 'localized', TRUE, 'egg'),
  (14, 'en', 'rice', 'localized', TRUE, 'rice'),
  (14, 'ko', '밥', 'native', TRUE, '밥'),
  (15, 'en', 'gochujang', 'localized', TRUE, 'gochujang'),
  (16, 'en', 'tomato', 'localized', TRUE, 'tomato'),
  (16, 'it', 'pomodoro', 'native', TRUE, 'pomodoro'),
  (17, 'en', 'mozzarella', 'localized', TRUE, 'mozzarella'),
  (18, 'en', 'seafood', 'localized', TRUE, 'seafood'),
  (19, 'en', 'corn tortilla', 'localized', TRUE, 'corn tortilla'),
  (20, 'en', 'chickpeas', 'localized', TRUE, 'chickpeas')
) AS v(rn, language_tag, name, name_kind, is_preferred, search_key)
  ON v.rn = i.rn
WHERE NOT EXISTS (
  SELECT 1 FROM feastjourney.ingredient_names e
  WHERE e.ingredient_id = i.id AND e.language_tag = v.language_tag AND e.name = v.name
);

-- ----------------------------------------------------------------- dishes ---
-- Parent families first, then variants referencing them.
INSERT INTO feastjourney.dishes (wikidata_id, parent_dish_id, status) VALUES
  ('Q192236', NULL, 'published'),
  (NULL, NULL, 'published'),
  (NULL, NULL, 'published'),
  ('Q615398', NULL, 'published'),
  (NULL, NULL, 'published'),
  (NULL, NULL, 'published'),
  ('Q477804', NULL, 'published'),
  (NULL, NULL, 'published'),
  (NULL, NULL, 'published'),
  (NULL, NULL, 'review'),
  (NULL, NULL, 'review'),
  (NULL, NULL, 'review')
ON CONFLICT DO NOTHING;

-- Resolve dish insertion order deterministically for name seeding below.
-- Names reference dishes by row order (oldest-first).
INSERT INTO feastjourney.dish_names (dish_id, language_tag, name, name_kind, is_preferred, search_key)
SELECT d.id, v.language_tag, v.name, v.name_kind, v.is_preferred, v.search_key
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 'vi', 'Phở', 'native', TRUE, 'pho'),
  (1, 'en', 'Pho', 'localized', TRUE, 'pho'),
  (1, 'en', 'pho noodle soup', 'alias', FALSE, 'pho noodle soup'),
  (2, 'vi', 'Phở bò', 'native', TRUE, 'pho bo'),
  (2, 'en', 'Pho bo', 'localized', TRUE, 'pho bo'),
  (2, 'en', 'beef pho', 'alias', FALSE, 'beef pho'),
  (3, 'vi', 'Bánh mì', 'native', TRUE, 'banh mi'),
  (3, 'en', 'Banh mi', 'localized', TRUE, 'banh mi'),
  (3, 'en', 'Vietnamese sandwich', 'alias', FALSE, 'vietnamese sandwich'),
  (4, 'ja', '寿司', 'native', TRUE, '寿司'),
  (4, 'en', 'Sushi', 'localized', TRUE, 'sushi'),
  (5, 'ja', 'ラーメン', 'native', TRUE, 'ラーメン'),
  (5, 'en', 'Ramen', 'localized', TRUE, 'ramen'),
  (6, 'ko', '비빔밥', 'native', TRUE, '비빔밥'),
  (6, 'en', 'Bibimbap', 'localized', TRUE, 'bibimbap'),
  (7, 'it', 'Pizza', 'native', TRUE, 'pizza'),
  (7, 'en', 'Pizza', 'localized', TRUE, 'pizza'),
  (8, 'es', 'Paella', 'native', TRUE, 'paella'),
  (8, 'en', 'Paella', 'localized', TRUE, 'paella'),
  (9, 'es', 'Tacos', 'native', TRUE, 'tacos'),
  (9, 'en', 'Tacos', 'localized', TRUE, 'tacos'),
  (10, 'en', 'Jollof rice', 'localized', TRUE, 'jollof rice'),
  (11, 'am', 'እንጀራ', 'native', TRUE, 'እንጀራ'),
  (11, 'en', 'Injera', 'localized', TRUE, 'injera'),
  (12, 'en', 'Falafel', 'localized', TRUE, 'falafel'),
  (12, 'ar', 'فلافل', 'native', TRUE, 'فلافل')
) AS v(rn, language_tag, name, name_kind, is_preferred, search_key)
  ON v.rn = d.rn
WHERE NOT EXISTS (
  SELECT 1 FROM feastjourney.dish_names e
  WHERE e.dish_id = d.id AND e.language_tag = v.language_tag AND e.name = v.name
);

-- Make Phở bò a variant of Phở (documented single-parent limitation).
UPDATE feastjourney.dishes child SET parent_dish_id = parent.id
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) parent,
     (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) childref
WHERE parent.rn = 1 AND child.id = childref.id AND childref.rn = 2
  AND child.parent_dish_id IS NULL;

INSERT INTO feastjourney.dish_descriptions (dish_id, language_tag, description, summary)
SELECT d.id, 'en', v.description, v.summary
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 'Phở is a Vietnamese noodle soup family, commonly served with rice noodles in aromatic broth.', 'Vietnamese noodle soup.'),
  (2, 'Phở bò is a beef variation of phở.', 'Beef phở.'),
  (3, 'Bánh mì is a Vietnamese sandwich served in a baguette with savory fillings and pickles.', 'Vietnamese baguette sandwich.'),
  (4, 'Sushi is a Japanese dish family centered on vinegared rice, often served with raw fish and nori.', 'Japanese vinegared-rice dish.'),
  (5, 'Ramen is a Japanese noodle soup served in rich broth with toppings such as egg and pork.', 'Japanese noodle soup.'),
  (6, 'Bibimbap is a Korean mixed rice dish topped with vegetables, egg, and gochujang.', 'Korean mixed rice.'),
  (7, 'Pizza is a baked flatbread dish associated with Italian cuisine, commonly topped with tomato and mozzarella.', 'Baked flatbread with toppings.'),
  (8, 'Paella is a Spanish rice dish traditionally cooked in a wide pan, often with seafood and saffron rice.', 'Spanish saffron rice dish.')
) AS v(rn, description, summary) ON v.rn = d.rn
ON CONFLICT (dish_id, language_tag) DO NOTHING;

-- Dish <-> ingredient links (typical composition, not measured recipes).
INSERT INTO feastjourney.dish_ingredients (dish_id, ingredient_id, role)
SELECT d.id, i.id, v.role
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 1, 'core'), (1, 2, 'core'), (1, 3, 'garnish'), (1, 4, 'common'),
  (2, 1, 'core'), (2, 2, 'core'),
  (3, 5, 'core'), (3, 6, 'common'), (3, 7, 'common'),
  (4, 8, 'core'), (4, 9, 'core'), (4, 10, 'common'),
  (5, 11, 'core'), (5, 12, 'core'), (5, 13, 'optional'),
  (6, 14, 'core'), (6, 15, 'common'), (6, 13, 'common'),
  (7, 16, 'core'), (7, 17, 'core'),
  (8, 14, 'core'), (8, 18, 'common')
) AS v(dish_rn, ing_rn, role) ON v.dish_rn = d.rn
JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.ingredients) i
  ON i.rn = v.ing_rn
ON CONFLICT DO NOTHING;

-- Dish <-> place links. Origin is a claim; popularity is not origin.
INSERT INTO feastjourney.dish_places (dish_id, place_id, association, is_disputed, note)
SELECT d.id, p.id, v.association, v.is_disputed, v.note
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 'VN', 'origin', FALSE, 'Widely associated with Vietnam; specific local origin kept as claim, not fact.'),
  (1, 'VN', 'popular', FALSE, 'Popular across Vietnam.'),
  (2, 'VN', 'origin', FALSE, 'Beef variation associated with Vietnam.'),
  (3, 'VN', 'origin', FALSE, 'Associated with Vietnam.'),
  (3, 'VN', 'popular', FALSE, 'Popular across Vietnam.'),
  (4, 'JP', 'origin', FALSE, 'Associated with Japan.'),
  (4, 'JP', 'popular', FALSE, 'Popular across Japan.'),
  (5, 'JP', 'origin', FALSE, 'Associated with Japan.'),
  (6, 'KR', 'origin', FALSE, 'Associated with Korea.'),
  (7, 'IT', 'origin', FALSE, 'Associated with Italy.'),
  (7, 'IT', 'popular', FALSE, 'Popular across Italy.'),
  (8, 'ES', 'origin', FALSE, 'Associated with Spain, especially the Valencian region.'),
  (9, 'MX', 'origin', FALSE, 'Associated with Mexico.'),
  (10, 'NG', 'associated', TRUE, 'Jollof heritage is shared across West Africa; Nigerian association recorded as disputed claim.'),
  (11, 'ET', 'origin', FALSE, 'Associated with Ethiopia.'),
  (12, 'IN', 'associated', TRUE, 'Levantine/Middle Eastern dish; seed links India only as associated-popular example for filter tests.')
) AS v(dish_rn, iso, association, is_disputed, note) ON v.dish_rn = d.rn
JOIN feastjourney.places p ON p.iso3166 = v.iso
ON CONFLICT DO NOTHING;

-- Dish <-> cuisine links (cuisine is not a country).
INSERT INTO feastjourney.dish_cuisines (dish_id, cuisine_id)
SELECT d.id, c.id
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 'vietnamese'), (2, 'vietnamese'), (3, 'vietnamese'),
  (4, 'japanese'), (5, 'japanese'), (6, 'korean'),
  (7, 'italian'), (8, 'spanish'), (9, 'mexican'),
  (10, 'nigerian'), (11, 'ethiopian'), (12, 'levantine')
) AS v(dish_rn, slug) ON v.dish_rn = d.rn
JOIN feastjourney.cuisines c ON c.slug = v.slug
ON CONFLICT DO NOTHING;

-- Dish <-> category links (many-to-many; meal occasion is cultural, not fixed).
INSERT INTO feastjourney.dish_categories (dish_id, category_id)
SELECT d.id, c.id
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.dishes) d
JOIN (VALUES
  (1, 'soup'), (1, 'noodles'), (1, 'main-course'), (1, 'lunch'), (1, 'dinner'),
  (2, 'soup'), (2, 'noodles'), (2, 'main-course'),
  (3, 'sandwich'), (3, 'main-course'), (3, 'lunch'), (3, 'street-food'),
  (4, 'main-course'), (4, 'lunch'), (4, 'dinner'),
  (5, 'soup'), (5, 'noodles'), (5, 'main-course'),
  (6, 'rice-dish'), (6, 'main-course'),
  (7, 'main-course'), (7, 'dinner'),
  (8, 'rice-dish'), (8, 'main-course'), (8, 'shared-platter')
) AS v(dish_rn, slug) ON v.dish_rn = d.rn
JOIN feastjourney.categories c ON c.slug = v.slug
ON CONFLICT DO NOTHING;
