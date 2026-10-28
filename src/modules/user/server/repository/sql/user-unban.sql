UPDATE "feastjourney"."user"
SET banned = false, "banReason" = NULL
WHERE id = :user_id;
