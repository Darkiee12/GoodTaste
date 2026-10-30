INSERT INTO feastjourney.roles (id, slug, name, description, color, position)
VALUES (:id::text, :slug::text, :name::text, :description::text, :color::text, :position::int)
RETURNING id, slug, name, description, color, position, is_system, is_protected;
