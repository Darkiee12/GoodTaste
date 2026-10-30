SELECT id, slug, name, description, color, position, is_system, is_protected
FROM feastjourney.roles
WHERE id = :id;
