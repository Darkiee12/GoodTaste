-- Import apply claim + first-party provider registry seeds.
--
-- 1) The apply path claims a validated job with a single conditional
--    UPDATE (validated -> applying, with re-entry on applying for crash
--    resume). The previous CHECK only admitted staged/validated/applied/
--    failed, so the intermediate applying state is added here. The
--    constraint is dropped and re-added (never left absent outside this
--    transaction) rather than left to drift from the service claim.
--
-- 2) The admin import studio stores the source registry id as the license
--    prefix (`<sourceId>:<license>`), and the apply path resolves provenance
--    through that prefix. Seed the four first-party registry providers so
--    normal manual/partner/community/other imports always resolve a
--    provider row; ad-hoc sources keep skipping provenance as before.
--    Idempotent: safe to replay via ON CONFLICT DO NOTHING.

SET search_path TO feastjourney, public;

ALTER TABLE feastjourney.catalog_import_jobs
  DROP CONSTRAINT IF EXISTS catalog_import_jobs_status_check;

ALTER TABLE feastjourney.catalog_import_jobs
  ADD CONSTRAINT catalog_import_jobs_status_check
  CHECK (status IN ('staged', 'validated', 'applying', 'applied', 'failed'));

INSERT INTO feastjourney.source_providers (slug, name, homepage_url) VALUES
  ('manual', 'Manual curator entry', NULL),
  ('partner', 'Partner dataset', NULL),
  ('community', 'Community contribution', NULL),
  ('other', 'Other / unlisted source', NULL)
ON CONFLICT (slug) DO NOTHING;
