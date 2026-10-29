INSERT INTO feastjourney.menu_scan_assets(session_id,object_key,page_number)
VALUES(:session_id::uuid,:key::text,:page_number::int) RETURNING id;
