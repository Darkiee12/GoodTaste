-- FeastJourney food catalog: canonical 3NF schema.
-- Owner: food-discovery (dishes, ingredients, categories, cuisines),
--         restaurant-discovery consults places for geosearch; places shared via workflow.
-- Schema: feastjourney (Flyway history also lives here; see docs/infra/migrations.md).
-- PostGIS extension itself is V20261027_001; this migration only uses relational types
-- (geosearch for venues arrives with restaurant-discovery; places carry ISO codes +
-- optional display coordinates, never conflated with origin claims).

CREATE SCHEMA IF NOT EXISTS feastjourney;
SET search_path TO feastjourney, public;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- ---------------------------------------------------------------- dishes ---
CREATE TABLE feastjourney.dishes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wikidata_id TEXT UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  parent_dish_id BIGINT REFERENCES feastjourney.dishes (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_dish_id IS NULL OR parent_dish_id <> id)
);
CREATE INDEX dishes_status_idx ON feastjourney.dishes (status);
CREATE INDEX dishes_parent_idx ON feastjourney.dishes (parent_dish_id);
CREATE INDEX dishes_updated_idx ON feastjourney.dishes (updated_at DESC);

-- ------------------------------------------------------------ dish names ---
CREATE TABLE feastjourney.dish_names (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  name_kind TEXT NOT NULL CHECK (name_kind IN ('native', 'localized', 'alias', 'transliteration')),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  search_key TEXT NOT NULL CHECK (char_length(search_key) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one preferred name per dish + language (partial unique index).
CREATE UNIQUE INDEX dish_names_preferred_uidx ON feastjourney.dish_names (dish_id, language_tag)
  WHERE is_preferred;
CREATE INDEX dish_names_dish_idx ON feastjourney.dish_names (dish_id);
CREATE INDEX dish_names_lang_idx ON feastjourney.dish_names (language_tag);
CREATE INDEX dish_names_search_trgm_idx ON feastjourney.dish_names USING gin (search_key gin_trgm_ops);
CREATE INDEX dish_names_name_trgm_idx ON feastjourney.dish_names USING gin (name gin_trgm_ops);

-- ----------------------------------------------------- dish descriptions ---
CREATE TABLE feastjourney.dish_descriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 20000),
  summary TEXT CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dish_id, language_tag)
);
CREATE INDEX dish_descriptions_dish_idx ON feastjourney.dish_descriptions (dish_id);

-- ------------------------------------------------------------- ingredients ---
CREATE TABLE feastjourney.ingredients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wikidata_id TEXT UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feastjourney.ingredient_names (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES feastjourney.ingredients (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  name_kind TEXT NOT NULL CHECK (name_kind IN ('native', 'localized', 'alias', 'transliteration')),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  search_key TEXT NOT NULL CHECK (char_length(search_key) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ingredient_names_preferred_uidx ON feastjourney.ingredient_names (ingredient_id, language_tag)
  WHERE is_preferred;
CREATE INDEX ingredient_names_ingredient_idx ON feastjourney.ingredient_names (ingredient_id);
CREATE INDEX ingredient_names_search_trgm_idx ON feastjourney.ingredient_names USING gin (search_key gin_trgm_ops);

CREATE TABLE feastjourney.dish_ingredients (
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES feastjourney.ingredients (id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('core', 'common', 'optional', 'garnish')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dish_id, ingredient_id)
);
CREATE INDEX dish_ingredients_ingredient_idx ON feastjourney.dish_ingredients (ingredient_id);
CREATE INDEX dish_ingredients_role_idx ON feastjourney.dish_ingredients (role);

-- ------------------------------------------------------------------ places ---
CREATE TABLE feastjourney.places (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('continent', 'region', 'country', 'subnational', 'province', 'locality')),
  wikidata_id TEXT UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  iso3166 TEXT CHECK (iso3166 ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  display_latitude DOUBLE PRECISION CHECK (display_latitude IS NULL OR (display_latitude BETWEEN -90 AND 90)),
  display_longitude DOUBLE PRECISION CHECK (display_longitude IS NULL OR (display_longitude BETWEEN -180 AND 180)),
  display_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (display_latitude IS NULL AND display_longitude IS NULL)
    OR (display_latitude IS NOT NULL AND display_longitude IS NOT NULL)
  )
);
CREATE INDEX places_kind_idx ON feastjourney.places (kind);
CREATE INDEX places_iso_idx ON feastjourney.places (iso3166);

CREATE TABLE feastjourney.place_names (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES feastjourney.places (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  search_key TEXT NOT NULL CHECK (char_length(search_key) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX place_names_preferred_uidx ON feastjourney.place_names (place_id, language_tag)
  WHERE is_preferred;
CREATE INDEX place_names_place_idx ON feastjourney.place_names (place_id);
CREATE INDEX place_names_search_trgm_idx ON feastjourney.place_names USING gin (search_key gin_trgm_ops);

-- Place hierarchy (DAG). Self-loops rejected; deeper cycles must be prevented
-- by the application/workflow (documented limitation of this version).
CREATE TABLE feastjourney.place_parents (
  place_id BIGINT NOT NULL REFERENCES feastjourney.places (id) ON DELETE CASCADE,
  parent_place_id BIGINT NOT NULL REFERENCES feastjourney.places (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (place_id, parent_place_id),
  CHECK (place_id <> parent_place_id)
);
CREATE INDEX place_parents_parent_idx ON feastjourney.place_parents (parent_place_id);

CREATE TABLE feastjourney.dish_places (
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  place_id BIGINT NOT NULL REFERENCES feastjourney.places (id) ON DELETE RESTRICT,
  association TEXT NOT NULL CHECK (association IN ('origin', 'associated', 'popular')),
  is_disputed BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dish_id, place_id, association)
);
CREATE INDEX dish_places_place_idx ON feastjourney.dish_places (place_id);
CREATE INDEX dish_places_assoc_idx ON feastjourney.dish_places (association);

-- ----------------------------------------------------------------- cuisines ---
CREATE TABLE feastjourney.cuisines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  wikidata_id TEXT UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feastjourney.cuisine_names (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cuisine_id BIGINT NOT NULL REFERENCES feastjourney.cuisines (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  search_key TEXT NOT NULL CHECK (char_length(search_key) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cuisine_names_preferred_uidx ON feastjourney.cuisine_names (cuisine_id, language_tag)
  WHERE is_preferred;
CREATE INDEX cuisine_names_cuisine_idx ON feastjourney.cuisine_names (cuisine_id);

CREATE TABLE feastjourney.dish_cuisines (
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  cuisine_id BIGINT NOT NULL REFERENCES feastjourney.cuisines (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dish_id, cuisine_id)
);
CREATE INDEX dish_cuisines_cuisine_idx ON feastjourney.dish_cuisines (cuisine_id);

-- --------------------------------------------------------------- categories ---
CREATE TABLE feastjourney.categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('meal_occasion', 'dish_type', 'course', 'serving_style')),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feastjourney.category_names (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES feastjourney.categories (id) ON DELETE CASCADE,
  language_tag TEXT NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX category_names_preferred_uidx ON feastjourney.category_names (category_id, language_tag)
  WHERE is_preferred;
CREATE INDEX category_names_category_idx ON feastjourney.category_names (category_id);

CREATE TABLE feastjourney.dish_categories (
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES feastjourney.categories (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dish_id, category_id)
);
CREATE INDEX dish_categories_category_idx ON feastjourney.dish_categories (category_id);

-- -------------------------------------------------------- source provenance ---
CREATE TABLE feastjourney.source_providers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  homepage_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feastjourney.source_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id BIGINT NOT NULL REFERENCES feastjourney.source_providers (id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 300),
  canonical_url TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision TEXT,
  license TEXT,
  attribution TEXT,
  import_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (import_status IN ('pending', 'imported', 'review', 'failed')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_id)
);
CREATE INDEX source_records_provider_idx ON feastjourney.source_records (provider_id);
CREATE INDEX source_records_status_idx ON feastjourney.source_records (import_status);

CREATE TABLE feastjourney.dish_sources (
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  source_record_id BIGINT NOT NULL REFERENCES feastjourney.source_records (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dish_id, source_record_id)
);
CREATE INDEX dish_sources_record_idx ON feastjourney.dish_sources (source_record_id);

-- -------------------------------------------- claim-level provenance ---------
-- Typed, constrained provenance for important claims (origin, ingredient,
-- category, cuisine). Generic EAV deliberately avoided: each claim references
-- at most one subject FK column, enforced by CHECK.
CREATE TABLE feastjourney.dish_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  claim_kind TEXT NOT NULL CHECK (claim_kind IN ('origin', 'ingredient', 'category', 'cuisine', 'name', 'description')),
  place_id BIGINT REFERENCES feastjourney.places (id) ON DELETE RESTRICT,
  ingredient_id BIGINT REFERENCES feastjourney.ingredients (id) ON DELETE RESTRICT,
  category_id BIGINT REFERENCES feastjourney.categories (id) ON DELETE RESTRICT,
  cuisine_id BIGINT REFERENCES feastjourney.cuisines (id) ON DELETE RESTRICT,
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
  is_disputed BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (claim_kind = 'origin' AND place_id IS NOT NULL AND ingredient_id IS NULL AND category_id IS NULL AND cuisine_id IS NULL)
    OR (claim_kind = 'ingredient' AND ingredient_id IS NOT NULL AND place_id IS NULL AND category_id IS NULL AND cuisine_id IS NULL)
    OR (claim_kind = 'category' AND category_id IS NOT NULL AND place_id IS NULL AND ingredient_id IS NULL AND cuisine_id IS NULL)
    OR (claim_kind = 'cuisine' AND cuisine_id IS NOT NULL AND place_id IS NULL AND ingredient_id IS NULL AND category_id IS NULL)
    OR (claim_kind IN ('name', 'description') AND place_id IS NULL AND ingredient_id IS NULL AND category_id IS NULL AND cuisine_id IS NULL)
  )
);
CREATE INDEX dish_claims_dish_idx ON feastjourney.dish_claims (dish_id);
CREATE INDEX dish_claims_kind_idx ON feastjourney.dish_claims (claim_kind);

CREATE TABLE feastjourney.claim_sources (
  claim_id BIGINT NOT NULL REFERENCES feastjourney.dish_claims (id) ON DELETE CASCADE,
  source_record_id BIGINT NOT NULL REFERENCES feastjourney.source_records (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, source_record_id)
);
CREATE INDEX claim_sources_record_idx ON feastjourney.claim_sources (source_record_id);

-- --------------------------------- dish updated_at maintenance ---------------
CREATE OR REPLACE FUNCTION feastjourney.touch_dish_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE feastjourney.dishes SET updated_at = now() WHERE id = COALESCE(NEW.dish_id, OLD.dish_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER dish_names_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_names
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
CREATE TRIGGER dish_descriptions_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_descriptions
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
CREATE TRIGGER dish_ingredients_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_ingredients
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
CREATE TRIGGER dish_places_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_places
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
CREATE TRIGGER dish_categories_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_categories
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
CREATE TRIGGER dish_cuisines_touch AFTER INSERT OR UPDATE OR DELETE ON feastjourney.dish_cuisines
  FOR EACH ROW EXECUTE FUNCTION feastjourney.touch_dish_updated_at();
