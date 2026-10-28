-- Import job approvals (server-enforced apply acknowledgements).
--
-- Validation is advisory; the apply gate must be enforced from stored job
-- state, never from client-supplied flags. These columns record who approved
-- an apply and which acknowledgements they gave: license review (required
-- only when the stored license/source needs it), a general review ack
-- (always required), and the duplicate external refs the approver accepted.
--
-- All columns are additive with safe defaults so existing staged, validated,
-- and applied jobs stay valid. Application code sets dry_run to false when
-- an apply run starts; approval columns are written as part of apply.

ALTER TABLE feastjourney.catalog_import_jobs
  ADD COLUMN IF NOT EXISTS approved_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS license_ack BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_ack BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS acknowledged_duplicates JSONB NOT NULL DEFAULT '[]';
