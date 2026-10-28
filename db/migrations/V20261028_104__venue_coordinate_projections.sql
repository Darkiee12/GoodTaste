-- Exact scalar projections of the one geographic source of truth. NOT NULL is
-- enforced here rather than inventing fallback coordinates in browser code.
ALTER TABLE feastjourney.restaurant_venues
 ADD COLUMN longitude DOUBLE PRECISION GENERATED ALWAYS AS (public.ST_X(location::public.geometry)) STORED NOT NULL,
 ADD COLUMN latitude DOUBLE PRECISION GENERATED ALWAYS AS (public.ST_Y(location::public.geometry)) STORED NOT NULL;
