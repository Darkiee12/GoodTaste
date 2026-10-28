-- Automatic Member assignment for every new account.
--
-- Design: the application requires every normal account to hold the Member
-- role (docs/architecture/access-control.md). Better Auth lifecycle hooks run
-- outside the user-insert transaction, so a hook cannot make this invariant
-- atomic. This trigger assigns Member in the same transaction that creates
-- the user row: either both commit or neither does, for every creation path
-- (email/password signup, OAuth signup, administrative inserts) without
-- trusting any caller to perform a second write.
--
-- Least privilege: only 'member' is ever assigned here. Privileged roles are
-- granted exclusively through the role-management operations, which enforce
-- delegation and protected-role policies. ON CONFLICT DO NOTHING keeps the
-- assignment idempotent and never resets or duplicates existing membership.

CREATE OR REPLACE FUNCTION feastjourney.assign_default_member_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO feastjourney.user_roles (user_id, role_id)
  VALUES (NEW.id, 'member')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_assign_default_member_role ON feastjourney."user";

CREATE TRIGGER user_assign_default_member_role
AFTER INSERT ON feastjourney."user"
FOR EACH ROW
EXECUTE FUNCTION feastjourney.assign_default_member_role();
