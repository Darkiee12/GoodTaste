SELECT id, slug, name
FROM feastjourney.source_providers
WHERE slug = :slug::text
