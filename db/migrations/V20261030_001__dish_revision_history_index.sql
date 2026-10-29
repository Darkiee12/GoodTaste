-- Feast Lab dish-detail history pagination. The dish-detail editor pages
-- revision history newest-first with a (created_at, id) keyset cursor, so it
-- needs a composite index that matches the ORDER BY exactly. The pre-existing
-- single-column indexes (catalog_revisions_dish_idx, catalog_revisions_created_idx)
-- cannot serve the per-dish newest-first scan without sorting, and the actor
-- attribution stays trustworthy without new columns: raw actor strings
-- (`member:<userId>`, `admin:<userId>`, `import:<jobId>`) resolve at read time
-- through user_profiles and catalog_import_jobs (approved_by), so old rows
-- remain readable and no data migration is required.
--
-- Additive only: index creation is idempotent and changes no stored rows.

CREATE INDEX IF NOT EXISTS catalog_revisions_dish_created_id_idx
  ON feastjourney.catalog_revisions (dish_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS curation_notes_dish_created_id_idx
  ON feastjourney.curation_notes (dish_id, created_at DESC, id DESC);
