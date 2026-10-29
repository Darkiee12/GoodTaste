UPDATE feastjourney.menu_scan_sessions SET expires_at=GREATEST(expires_at,now()+INTERVAL '30 days') WHERE id=:id::uuid;
