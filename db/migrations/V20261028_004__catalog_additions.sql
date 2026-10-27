-- FeastJourney catalog additions: Phở gà variant and Valencia locality.
-- All facts are first-party curated seed data, open to correction via
-- curation notes; popularity links never imply origin.

SET search_path TO feastjourney, public;

-- Chicken ingredient concept (distinct from other poultry preparations).
INSERT INTO feastjourney.ingredients DEFAULT VALUES;

INSERT INTO feastjourney.ingredient_names (ingredient_id, language_tag, name, name_kind, is_preferred, search_key)
SELECT i.id, v.language_tag, v.name, v.name_kind, v.is_preferred, v.search_key
FROM (SELECT id, row_number() OVER (ORDER BY id DESC) AS rn FROM feastjourney.ingredients) AS i
JOIN (VALUES
  (1, 'en', 'chicken', 'localized', TRUE, 'chicken'),
  (1, 'vi', 'thịt gà', 'native', TRUE, 'thit ga')
) AS v(rn, language_tag, name, name_kind, is_preferred, search_key)
  ON v.rn = i.rn
WHERE NOT EXISTS (
  SELECT 1 FROM feastjourney.ingredient_names AS e
  WHERE e.ingredient_id = i.id AND e.language_tag = v.language_tag AND e.name = v.name
);

-- Phở gà as a variant of Phở (single-parent family link, documented limitation).
INSERT INTO feastjourney.dishes (slug, parent_dish_id, status)
SELECT 'pho-ga', parent.id, 'published'
FROM feastjourney.dishes AS parent
WHERE parent.slug = 'pho'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO feastjourney.dish_names (dish_id, language_tag, name, name_kind, is_preferred, search_key)
SELECT d.id, v.language_tag, v.name, v.name_kind, v.is_preferred, v.search_key
FROM feastjourney.dishes AS d
JOIN (VALUES
  ('pho-ga', 'vi', 'Phở gà', 'native', TRUE, 'pho ga'),
  ('pho-ga', 'en', 'Pho ga', 'localized', TRUE, 'pho ga'),
  ('pho-ga', 'en', 'chicken pho', 'alias', FALSE, 'chicken pho'),
  ('pho-ga', 'vi', 'Pho ga', 'transliteration', FALSE, 'pho ga')
) AS v(slug, language_tag, name, name_kind, is_preferred, search_key)
  ON v.slug = d.slug
WHERE NOT EXISTS (
  SELECT 1 FROM feastjourney.dish_names AS e
  WHERE e.dish_id = d.id AND e.language_tag = v.language_tag AND e.name = v.name
);

INSERT INTO feastjourney.dish_descriptions (dish_id, language_tag, description, summary)
SELECT d.id, 'en', 'Phở gà is a chicken variation of phở.', 'Chicken phở.'
FROM feastjourney.dishes AS d
WHERE d.slug = 'pho-ga'
ON CONFLICT (dish_id, language_tag) DO NOTHING;

INSERT INTO feastjourney.dish_ingredients (dish_id, ingredient_id, role)
SELECT d.id, i.id, v.role
FROM (VALUES ('pho-ga', 1, 'core'), ('pho-ga', 21, 'core')) AS v(slug, ing_rn, role)
JOIN feastjourney.dishes AS d ON d.slug = v.slug
JOIN (
  SELECT id, row_number() OVER (ORDER BY id) AS rn FROM feastjourney.ingredients
) AS i ON i.rn = v.ing_rn
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.dish_places (dish_id, place_id, association, is_disputed, note)
SELECT d.id, p.id, 'origin', FALSE, 'Chicken phở variation associated with Vietnam.'
FROM feastjourney.dishes AS d
JOIN feastjourney.places AS p ON p.iso3166 = 'VN'
WHERE d.slug = 'pho-ga'
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.dish_categories (dish_id, category_id)
SELECT d.id, c.id
FROM (VALUES ('pho-ga', 'soup'), ('pho-ga', 'noodles'), ('pho-ga', 'main')) AS v(dish_slug, slug)
JOIN feastjourney.dishes AS d ON d.slug = v.dish_slug
JOIN feastjourney.categories AS c ON c.slug = v.slug
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.dish_cuisines (dish_id, cuisine_id)
SELECT d.id, c.id
FROM feastjourney.dishes AS d
JOIN feastjourney.cuisines AS c ON c.slug = 'vietnamese'
WHERE d.slug = 'pho-ga'
ON CONFLICT DO NOTHING;

-- Valencia locality for map display (placement, not an origin claim).
INSERT INTO feastjourney.places (kind, iso3166, display_latitude, display_longitude, display_note)
VALUES ('locality', NULL, 39.4699, -0.3763, 'Valencia city placement.')
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.place_names (place_id, language_tag, name, is_preferred, search_key)
SELECT p.id, 'en', 'Valencia', TRUE, 'valencia'
FROM feastjourney.places AS p
WHERE p.kind = 'locality' AND p.display_latitude = 39.4699 AND p.display_longitude = -0.3763
ON CONFLICT DO NOTHING;

INSERT INTO feastjourney.place_parents (place_id, parent_place_id)
SELECT child.id, parent.id
FROM feastjourney.places AS child
JOIN feastjourney.places AS parent ON parent.iso3166 = 'ES'
JOIN feastjourney.place_names AS cpn ON cpn.place_id = child.id AND cpn.name = 'Valencia'
ON CONFLICT DO NOTHING;

-- Paella is popular in Valencia; popularity is recorded as popular, not origin.
INSERT INTO feastjourney.dish_places (dish_id, place_id, association, is_disputed, note)
SELECT d.id, p.id, 'popular', FALSE, 'Paella is widely served in Valencia; popularity is not an origin claim.'
FROM feastjourney.dishes AS d
JOIN feastjourney.place_names AS pn ON pn.name = 'Valencia' AND pn.is_preferred
JOIN feastjourney.places AS p ON p.id = pn.place_id
WHERE d.slug = 'paella'
ON CONFLICT DO NOTHING;
