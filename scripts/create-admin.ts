import postgres from "postgres";

import { auth } from "@/server/auth/better-auth";
import { serverEnv } from "@/server/env";

/**
 * Explicit administrator bootstrap. This is an operations process, not a
 * public sign-up path: it requires shell access, the database URL, and
 * explicit arguments. It cannot be invoked through any HTTP request.
 *
 *   bun scripts/create-admin.ts admin@example.com 'strong-password-here'
 *
 * The account is created verified (the operator proves mailbox control
 * out-of-band) and granted the protected owner role plus baseline member
 * access directly in the database. Every use must be recorded out-of-band;
 * the role change itself is also written to the audit log table.
 */
const [email, password] = process.argv.slice(2);

if (email === undefined || password === undefined || password.length < 12) {
  process.stderr.write("usage: bun scripts/create-admin.ts <email> <password-min-12-chars>\n");
  process.exit(1);
}

const env = serverEnv();
const sql = postgres(env.DATABASE_URL, { max: 1 });

try {
  await auth.api.signUpEmail({ body: { email, password, name: email } });

  const rows = await sql<{ id: string }[]>`
    SELECT id FROM "feastjourney"."user" WHERE email = ${email}
  `;

  if (rows.length === 0) {
    throw new Error("bootstrap sign-up did not create the user");
  }

  const userId = rows[0].id;

  await sql`
    UPDATE "feastjourney"."user"
    SET role = 'owner', "emailVerified" = true
    WHERE id = ${userId}
  `;
  await sql`
    INSERT INTO feastjourney.user_roles (user_id, role_id, assigned_by)
    VALUES (${userId}, 'member', ${userId})
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO feastjourney.user_roles (user_id, role_id, assigned_by)
    VALUES (${userId}, 'owner', ${userId})
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO feastjourney.security_audit_events
      (actor_user_id, request_id, event, outcome, resource, metadata)
    VALUES
      (${userId}, ${`bootstrap:${Date.now()}`}, 'auth.role.changed', 'succeeded', ${`user:${userId}`}, ${'{"role":"owner","via":"bootstrap-cli"}'}::jsonb)
  `;

  process.stdout.write(`admin created: ${userId} (${email})\n`);
} finally {
  await sql.end();
}
