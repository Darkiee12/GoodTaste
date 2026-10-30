-- Batched import persistence (Agent 1: import batching architecture).
--
-- The 100-records/job guard is replaced by a chunked stage/validate/apply
-- protocol over ONE logical job: the client parses locally and posts bounded
-- batches (~100 records per server call); the server never holds the whole
-- dataset in one transaction or one server-function budget.
--
-- ONE logical job id, ONE source/provenance row, ONE review/apply flow.
-- Original per-record positions survive in catalog_import_records.record_index
-- (UNIQUE per job: the idempotency key that makes batch retries safe), and
-- record_slug carries the slugged identity used for GLOBAL duplicate
-- detection across batches without loading every payload at once.
--
-- Job lifecycle (status CHECK unchanged: staged/validated/applying/applied/
-- failed): a batched job is created `staged` with total_records = declared
-- dataset size and staged_count = 0. `staged` now means "open for batch
-- appends while staged_count < total_records"; the final batch flips the job
-- to `validated` (>= 1 valid record) or `failed`. Apply still requires
-- `validated` and still claims `validated -> applying`, so all existing
-- review/apply gates and the crash-resume story hold unchanged.
--
-- Progress is persisted per batch, so any crash or budget timeout resumes
-- from stored counters, never from a client resend of the full file:
-- staged_count doubles as the stage cursor (next batch must start exactly
-- there); applied/skipped/failed counts accumulate per apply batch; the
-- apply cursor itself is derived from row statuses (only `valid` rows are
-- ever picked up, so applied rows are never replayed).
--
-- All columns are additive with safe defaults. Existing jobs backfill
-- staged_count = total_records (their batches are, by definition, complete);
-- legacy rows keep record_index/record_slug NULL and are exempt from the new
-- partial unique index.

SET search_path TO feastjourney, public;

ALTER TABLE feastjourney.catalog_import_jobs
  ADD COLUMN IF NOT EXISTS staged_count INTEGER NOT NULL DEFAULT 0
    CHECK (staged_count >= 0),
  ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0
    CHECK (applied_count >= 0),
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0
    CHECK (skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS apply_failed_count INTEGER NOT NULL DEFAULT 0
    CHECK (apply_failed_count >= 0);

-- Legacy single-shot jobs staged their full dataset atomically: mark their
-- progress complete so the batch protocol reads them as already received.
UPDATE feastjourney.catalog_import_jobs
SET staged_count = total_records
WHERE staged_count = 0 AND status <> 'staged';

-- Jobs still sitting in `staged` predate batching; treat whatever they hold
-- as their complete dataset (a newer client resumes from this cursor).
UPDATE feastjourney.catalog_import_jobs
SET staged_count = total_records
WHERE staged_count = 0;

ALTER TABLE feastjourney.catalog_import_records
  ADD COLUMN IF NOT EXISTS record_index INTEGER NULL CHECK (record_index IS NULL OR record_index >= 0),
  ADD COLUMN IF NOT EXISTS record_slug TEXT NULL
    CHECK (record_slug IS NULL OR char_length(record_slug) BETWEEN 1 AND 300);

-- Idempotency key: (job, original position) is unique, so a retried batch
-- can never double-insert. Partial index keeps legacy NULL rows exempt.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_import_records_job_position_uidx
  ON feastjourney.catalog_import_records (job_id, record_index)
  WHERE record_index IS NOT NULL;

-- Cross-batch duplicate scan: one indexed lookup finds every slugged ref
-- already staged for the job, without parsing stored payloads in memory.
CREATE INDEX IF NOT EXISTS catalog_import_records_job_slug_idx
  ON feastjourney.catalog_import_records (job_id, record_slug)
  WHERE record_slug IS NOT NULL;
