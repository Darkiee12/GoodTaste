SELECT id, slug, kind
FROM feastjourney.categories
WHERE slug = ANY(:slugs::text[])
