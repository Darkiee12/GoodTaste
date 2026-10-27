INSERT INTO feastjourney.dish_names (dish_id, language_tag, name, name_kind, is_preferred, search_key)
VALUES (:dish_id::bigint, :language_tag::text, :name::text, :name_kind::text, :is_preferred::boolean, :search_key::text)
RETURNING id, dish_id, language_tag, name, name_kind, is_preferred, search_key
