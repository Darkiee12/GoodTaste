-- Preserve printed tokens separately from authoritative exact NUMERIC interpretations.
ALTER TABLE feastjourney.restaurant_price_observations ADD COLUMN raw_text TEXT CHECK(length(raw_text)<=200);
