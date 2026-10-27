SELECT c.id AS id, c.kind AS kind, c.slug AS slug, n.language_tag AS language_tag, n.name AS name, n.is_preferred AS is_preferred
FROM feastjourney.categories AS c
JOIN feastjourney.category_names AS n ON n.category_id = c.id
ORDER BY c.kind ASC, c.slug ASC, n.language_tag ASC, n.name ASC
