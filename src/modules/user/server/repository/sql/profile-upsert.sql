INSERT INTO feastjourney.user_profiles (user_id, display_name, locale)
VALUES (:user_id::text, :display_name::nullable(text), :locale::text)
ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
    locale = EXCLUDED.locale,
    updated_at = now()
RETURNING user_id, display_name, locale;
