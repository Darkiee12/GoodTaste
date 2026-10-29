INSERT INTO feastjourney.restaurant_menu_items(id,venue_id,menu_id,name,description,status)
VALUES(:id::uuid,:venue::uuid,:menu::uuid,:name::text,:description::text,'draft')
ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id
WHERE feastjourney.restaurant_menu_items.venue_id=EXCLUDED.venue_id
 AND feastjourney.restaurant_menu_items.menu_id=EXCLUDED.menu_id
 AND feastjourney.restaurant_menu_items.name=EXCLUDED.name
 AND feastjourney.restaurant_menu_items.description=EXCLUDED.description
RETURNING id;
