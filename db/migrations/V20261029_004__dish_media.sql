-- First-party dish photography for the discovery carousel. One row is one
-- reviewed public image for a dish; the carousel shows the first published
-- image per dish and falls back to a placeholder when none exists.
-- Binary bytes live in object storage (object_key); an approved externally
-- hosted file can be referenced instead (public_url, https only, enforced
-- in the read projection). Never point rows at private menu-scan uploads.

CREATE TABLE feastjourney.dish_media (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dish_id BIGINT NOT NULL REFERENCES feastjourney.dishes (id) ON DELETE CASCADE,
  object_key TEXT,
  public_url TEXT CHECK (public_url IS NULL OR public_url ~ '^https://'),
  attribution TEXT,
  license TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'published')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_text TEXT,
  focal_x DOUBLE PRECISION CHECK (focal_x IS NULL OR (focal_x >= 0 AND focal_x <= 1)),
  focal_y DOUBLE PRECISION CHECK (focal_y IS NULL OR (focal_y >= 0 AND focal_y <= 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (object_key IS NOT NULL OR public_url IS NOT NULL)
);
CREATE INDEX dish_media_dish_idx ON feastjourney.dish_media (dish_id, status, sort_order, id);
