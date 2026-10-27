SELECT dish_id, language_tag, description, summary
FROM feastjourney.dish_descriptions
WHERE dish_id = ANY(:ids::bigint[])
ORDER BY dish_id ASC, language_tag ASC
