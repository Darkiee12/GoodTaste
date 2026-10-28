INSERT INTO feastjourney.restaurant_menu_item_variants(id,venue_id,menu_item_id,name,comparison_key)
VALUES(:id::uuid,:venue::uuid,:item::uuid,:name::text,:comparison::nullable(text))
ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id
WHERE feastjourney.restaurant_menu_item_variants.venue_id=EXCLUDED.venue_id
 AND feastjourney.restaurant_menu_item_variants.menu_item_id=EXCLUDED.menu_item_id
 AND feastjourney.restaurant_menu_item_variants.name=EXCLUDED.name
 AND feastjourney.restaurant_menu_item_variants.comparison_key IS NOT DISTINCT FROM EXCLUDED.comparison_key
RETURNING id;
