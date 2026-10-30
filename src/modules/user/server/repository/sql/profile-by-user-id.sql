SELECT user_id, display_name, locale
FROM feastjourney.user_profiles
WHERE user_id = :user_id;
