SELECT c.id AS id, c.slug AS slug, n.language_tag AS language_tag, n.name AS name, n.is_preferred AS is_preferred
FROM feastjourney.cuisines AS c
JOIN feastjourney.cuisine_names AS n ON n.cuisine_id = c.id
ORDER BY c.slug ASC, n.language_tag ASC, n.name ASC
