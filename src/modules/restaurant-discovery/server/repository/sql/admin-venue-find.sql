SELECT id,business_id,address,country_code,longitude,latitude
FROM feastjourney.restaurant_venues WHERE id=:id::uuid FOR UPDATE;
