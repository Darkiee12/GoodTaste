SELECT d.id::text AS id, d.slug, d.status, d.created_at, d.updated_at,
  (SELECT n.name
   FROM feastjourney.dish_names AS n
   WHERE n.dish_id = d.id
   ORDER BY (n.language_tag = 'en') DESC, n.is_preferred DESC, n.id ASC
   LIMIT 1) AS display_name
FROM feastjourney.dishes AS d
ORDER BY d.updated_at DESC, d.id DESC
LIMIT :limit::int
