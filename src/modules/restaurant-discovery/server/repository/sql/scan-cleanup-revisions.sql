DELETE FROM feastjourney.menu_scan_revisions r USING feastjourney.menu_scan_sessions s
WHERE r.session_id=s.id AND s.status='deleted'
AND NOT EXISTS (SELECT 1 FROM feastjourney.menu_scan_contributions c WHERE c.session_id=r.session_id AND c.revision=r.revision);
