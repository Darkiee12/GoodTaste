-- Bounded bulk publish: flips only rows still in `review` to `published`.
-- Rows already published, archived, in draft, or missing are left untouched
-- and absent from RETURNING, so the caller derives per-record skipped
-- outcomes without a second read. The caller passes only ids that already
-- passed the per-dish publication checklist (mechanical validation is never
-- editorial approval); this statement enforces the status guard, never the
-- checklist. One statement, bounded by the caller's id array (the transport
-- caps batches); never an open-ended UPDATE.
UPDATE feastjourney.dishes
SET status = 'published'
WHERE id = ANY(:ids::bigint[])
  AND status = 'review'
RETURNING id::text AS id, slug, status
