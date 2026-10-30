-- Import job source metadata (additive, nullable).
--
-- The initial import tables (V20261028_003) stored only a free-text
-- source_name. The import studio records where each dataset came from and
-- on what reuse basis, so curators can audit provenance and license
-- reviewers can spot ambiguous sources before records are applied.
--
-- All columns are nullable so existing jobs stay valid. The `format`
-- check is widened to accept staged CSV uploads alongside JSON; the
-- staged payload itself remains the validated AuthoringDish records, so
-- no downstream consumer changes.

ALTER TABLE feastjourney.catalog_import_jobs
  ADD COLUMN IF NOT EXISTS source_url TEXT CHECK (source_url IS NULL OR char_length(source_url) BETWEEN 1 AND 2000),
  ADD COLUMN IF NOT EXISTS source_version TEXT CHECK (source_version IS NULL OR char_length(source_version) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS license TEXT CHECK (license IS NULL OR char_length(license) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS attribution TEXT CHECK (attribution IS NULL OR char_length(attribution) BETWEEN 1 AND 2000),
  ADD COLUMN IF NOT EXISTS editorial_notes TEXT CHECK (editorial_notes IS NULL OR char_length(editorial_notes) BETWEEN 1 AND 2000);

ALTER TABLE feastjourney.catalog_import_jobs
  DROP CONSTRAINT IF EXISTS catalog_import_jobs_format_check;

ALTER TABLE feastjourney.catalog_import_jobs
  ADD CONSTRAINT catalog_import_jobs_format_check CHECK (format IN ('json', 'csv'));
