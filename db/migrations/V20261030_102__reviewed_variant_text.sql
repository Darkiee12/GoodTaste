-- Preserve reviewed translations alongside original variant labels.
ALTER TABLE feastjourney.restaurant_menu_item_variants
 ADD COLUMN translation_language TEXT CHECK(translation_language IS NULL OR translation_language IN ('en','vi','ja','zh','ko','fr','es')),
 ADD COLUMN translated_label TEXT CHECK(length(translated_label) BETWEEN 1 AND 300),
 ADD CONSTRAINT restaurant_variant_translation_language CHECK(translated_label IS NULL OR translation_language IS NOT NULL);
