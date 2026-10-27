SELECT ingredient_id, language_tag, name, name_kind, is_preferred, search_key
FROM feastjourney.ingredient_names
WHERE ingredient_id = ANY(:ids::bigint[])
ORDER BY ingredient_id ASC, language_tag ASC, name ASC
