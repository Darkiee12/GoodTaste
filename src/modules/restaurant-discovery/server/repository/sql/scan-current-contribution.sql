SELECT id,status,revision FROM feastjourney.menu_scan_contributions
WHERE session_id=:session_id::uuid ORDER BY revision DESC LIMIT 1;
