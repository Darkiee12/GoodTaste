INSERT INTO feastjourney.menu_scan_contributions(session_id,revision,consent_terms,requested_venue_id,retention_until)
VALUES(:session_id::uuid,:revision::int,'menu-facts-v1',:venue_id::nullable(uuid),now()+INTERVAL '30 days')
ON CONFLICT(session_id,revision) DO UPDATE SET id=feastjourney.menu_scan_contributions.id
RETURNING id,status;
