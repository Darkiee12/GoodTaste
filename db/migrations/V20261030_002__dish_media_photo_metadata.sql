-- First-party dish photography: processing, provenance, and review metadata.
--
-- Additive only: extends feastjourney.dish_media (V20261029_004) without
-- touching existing columns, constraints, or rows. All new columns are
-- nullable or defaulted so current draft/review/published rows and their
-- public_url delivery keep working unchanged.
--
-- Columns:
-- - original_width / original_height: decoded source dimensions in pixels.
-- - format: normalized source container ("jpeg" | "png" | "webp").
-- - byte_size: stored original byte count (Postgres never holds binaries).
-- - checksum_sha256: hex SHA-256 of the validated source bytes.
-- - variant_version: opaque generation counter for immutable derivative URLs
--   (dish-media/dishes/{dishId}/{mediaId}/{version}/{width}.webp).
-- - uploaded_by: member user id that staged the photo.
-- - processing: staged-finalize state machine
--   ('processing' -> 'ready' | 'failed'). Only 'ready' rows may publish.
-- - reviewed_at / published_at: audit timestamps for review transitions.
-- - source_url: optional provenance link (never fetched by the server).

ALTER TABLE feastjourney.dish_media
  ADD COLUMN IF NOT EXISTS original_width INTEGER
    CHECK (original_width IS NULL OR original_width > 0),
  ADD COLUMN IF NOT EXISTS original_height INTEGER
    CHECK (original_height IS NULL OR original_height > 0),
  ADD COLUMN IF NOT EXISTS format TEXT
    CHECK (format IS NULL OR format IN ('jpeg', 'png', 'webp')),
  ADD COLUMN IF NOT EXISTS byte_size BIGINT
    CHECK (byte_size IS NULL OR byte_size > 0),
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS variant_version INTEGER NOT NULL DEFAULT 1
    CHECK (variant_version >= 1),
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT,
  ADD COLUMN IF NOT EXISTS processing TEXT NOT NULL DEFAULT 'ready'
    CHECK (processing IN ('processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_url TEXT
    CHECK (source_url IS NULL OR source_url ~ '^https://');

CREATE INDEX IF NOT EXISTS dish_media_publishable_idx
  ON feastjourney.dish_media (dish_id, status, processing, sort_order, id);
