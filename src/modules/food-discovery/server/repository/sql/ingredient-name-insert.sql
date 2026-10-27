INSERT INTO feastjourney.ingredient_names
  (ingredient_id, language_tag, name, name_kind, is_preferred, search_key)
VALUES
  (:ingredient_id::bigint, :language_tag::text, :name::text,
   :name_kind::text, :is_preferred::boolean, :search_key::text)
RETURNING ingredient_id, language_tag, name, name_kind, is_preferred, search_key
