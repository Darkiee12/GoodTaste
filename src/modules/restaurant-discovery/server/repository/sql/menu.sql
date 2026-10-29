SELECT m.id AS menu_id,m.name AS menu_name,i.id AS item_id,i.name AS item_name,i.description,
 v.id AS variant_id,v.name AS variant_name,v.comparison_key,
 p.observation_id,p.amount,p.currency,p.price_kind,p.sales_channel,p.tax_treatment,
 p.observed_at,p.current_enough,p.source_category,p.source_url,
 e.dish_id::text AS dish_id,e.match_kind
FROM feastjourney.restaurant_menu_items i
JOIN feastjourney.restaurant_menus m ON(m.id,m.venue_id)=(i.menu_id,i.venue_id)
JOIN feastjourney.restaurant_venues r ON r.id=i.venue_id
JOIN feastjourney.restaurant_menu_item_variants v ON(v.menu_item_id,v.venue_id)=(i.id,i.venue_id)
LEFT JOIN feastjourney.restaurant_selected_prices p ON p.variant_id=v.id AND p.sales_channel=:channel::text
LEFT JOIN LATERAL(SELECT ev.dish_id,ev.match_kind FROM feastjourney.restaurant_eligible_evidence ev
 WHERE ev.menu_item_id=i.id AND ev.dish_id = ANY(:published_dish_ids::bigint[])
 ORDER BY ev.evidence_tier,ev.observed_at DESC,ev.id LIMIT 1) e ON true
WHERE v.status='published' AND i.venue_id=:id::uuid AND r.status='published' AND m.status='published' AND i.status='published'
ORDER BY m.name,m.id,i.name,i.id,v.name,v.id;
