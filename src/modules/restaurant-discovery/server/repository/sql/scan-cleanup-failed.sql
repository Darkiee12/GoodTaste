UPDATE feastjourney.menu_scan_assets SET delete_attempts=delete_attempts+1 WHERE id=:id::uuid;
