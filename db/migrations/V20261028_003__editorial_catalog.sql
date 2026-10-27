-- FeastJourney V004: first-party catalog identity, editorial governance.
-- Drops encyclopedia-coupled columns/provenance in favor of owned slugs and
-- internal audit records. One-way forward migration; applied once per database.

SET search_path TO feastjourney, public;

-- ------------------------------------------------- dish slugs (owned IDs) ---
ALTER TABLE feastjourney.dishes ADD COLUMN slug TEXT;

UPDATE feastjourney.dishes AS d
SET slug = trim(
  both '-' from lower(regexp_replace(n.name, '[^A-Za-z0-9]+', '-', 'g'))
)
FROM (
  SELECT DISTINCT ON (dish_id) dish_id, name
  FROM feastjourney.dish_names
  WHERE language_tag = 'en' AND is_preferred
  ORDER BY dish_id
) AS n
WHERE n.dish_id = d.id;

ALTER TABLE feastjourney.dishes ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX dishes_slug_uidx ON feastjourney.dishes (slug);
ALTER TABLE feastjourney.dishes
  ADD CONSTRAINT dishes_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- --------------------------------- drop encyclopedia-coupled columns --------
ALTER TABLE feastjourney.dishes DROP COLUMN IF EXISTS wikidata_id;
ALTER TABLE feastjourney.ingredients DROP COLUMN IF EXISTS wikidata_id;
ALTER TABLE feastjourney.places DROP COLUMN IF EXISTS wikidata_id;
ALTER TABLE feastjourney.cuisines DROP COLUMN IF EXISTS wikidata_id;

-- Claim-level external provenance is replaced by internal editorial records.
DROP TABLE IF EXISTS feastjourney.claim_sources;
DROP TABLE IF EXISTS feastjourney.dish_claims;

DELETE FROM feastjourney.dish_sources
WHERE source_record_id IN (
  SELECT r.id
  FROM feastjourney.source_records AS r
  JOIN feastjourney.source_providers AS p ON p.id = r.provider_id
  WHERE p.slug IN ('wikidata', 'wikipedia')
);
DELETE FROM feastjourney.source_records
WHERE provider_id IN (
  SELECT id FROM feastjourney.source_providers WHERE slug IN ('wikidata', 'wikipedia')
);
DELETE FROM feastjourney.source_providers WHERE slug IN ('wikidata', 'wikipedia');

-- --------------------------------- category slug alignment -----------------
-- Canonical course slugs: appetizer, main, side, dessert.
UPDATE feastjourney.categories SET slug = 'main' WHERE slug = 'main-course';
UPDATE feastjourney.categories SET slug = 'side' WHERE slug = 'side-dish';

-- --------------------------------- place hierarchy cycle guard -------------
-- Rejects self-loops (also covered by CHECK) and any ancestor/descendant
-- cycle: the new parent must not already be reachable from the child.
CREATE OR REPLACE FUNCTION feastjourney.check_place_parent_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.place_id = NEW.parent_place_id THEN
    RAISE EXCEPTION 'place hierarchy cycle: % cannot parent itself', NEW.place_id;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_place_id AS id
      UNION
      SELECT pp.parent_place_id AS id
      FROM feastjourney.place_parents AS pp
      JOIN ancestors AS a ON a.id = pp.place_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.place_id
  ) THEN
    RAISE EXCEPTION 'place hierarchy cycle: % is already an ancestor of %',
      NEW.place_id, NEW.parent_place_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS place_parents_no_cycle ON feastjourney.place_parents;
CREATE TRIGGER place_parents_no_cycle
  BEFORE INSERT OR UPDATE ON feastjourney.place_parents
  FOR EACH ROW EXECUTE FUNCTION feastjourney.check_place_parent_cycle();

-- --------------------------------- editorial and audit records -------------
CREATE TABLE feastjourney.catalog_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 200),
  operation TEXT NOT NULL CHECK (
    operation IN (
      'created', 'status_changed', 'name_added', 'description_updated',
      'ingredient_linked', 'place_linked', 'category_linked', 'cuisine_linked',
      'import_applied', 'note_added'
    )
  ),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX catalog_revisions_dish_idx ON feastjourney.catalog_revisions (dish_id);
CREATE INDEX catalog_revisions_created_idx ON feastjourney.catalog_revisions (created_at DESC);

CREATE TABLE feastjourney.curation_notes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (char_length(author) BETWEEN 1 AND 200),
  note_kind TEXT NOT NULL CHECK (note_kind IN ('review', 'correction', 'question')),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX curation_notes_dish_idx ON feastjourney.curation_notes (dish_id);

CREATE TABLE feastjourney.catalog_import_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_name TEXT NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 200),
  format TEXT NOT NULL CHECK (format IN ('json')),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'validated', 'applied', 'failed')),
  total_records INTEGER NOT NULL CHECK (total_records >= 0),
  valid_records INTEGER NOT NULL DEFAULT 0 CHECK (valid_records >= 0),
  invalid_records INTEGER NOT NULL DEFAULT 0 CHECK (invalid_records >= 0),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX catalog_import_jobs_status_idx ON feastjourney.catalog_import_jobs (status);

CREATE TABLE feastjourney.catalog_import_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES feastjourney.catalog_import_jobs (id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL CHECK (char_length(external_ref) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'invalid', 'applied', 'skipped_duplicate')),
  errors JSONB,
  dish_id BIGINT REFERENCES feastjourney.dishes (id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, external_ref)
);
CREATE INDEX catalog_import_records_job_idx ON feastjourney.catalog_import_records (job_id);
CREATE INDEX catalog_import_records_status_idx ON feastjourney.catalog_import_records (status);
