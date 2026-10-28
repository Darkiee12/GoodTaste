UPDATE "feastjourney"."user"
SET banned = true, "banReason" = :reason::nullable(text)
WHERE id = :user_id;
