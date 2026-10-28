INSERT INTO feastjourney.user_roles (user_id, role_id, assigned_by)
VALUES (:user_id::text, :role_id::text, :assigned_by::nullable(text))
ON CONFLICT DO NOTHING;
