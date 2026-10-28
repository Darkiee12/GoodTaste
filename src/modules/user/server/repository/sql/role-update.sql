UPDATE feastjourney.roles
SET slug = :slug::text,
  name = :name::text,
  description = :description::text,
  color = :color::text,
  position = :position::int,
  updated_at = now()
WHERE id = :id::text
RETURNING id, slug, name, description, color, position, is_system, is_protected;
