import { Brand } from "effect";
import { z } from "zod";

/**
 * Nominal identifiers for the user domain. TypeScript's structural typing
 * would otherwise let a user ID flow into a role ID argument unnoticed, so
 * every cross-entity reference uses a branded primitive.
 *
 * `parse` validates unknown input (transport boundary). Repositories take
 * plain strings for database values; callers parse untrusted input once at
 * the boundary instead of revalidating trusted values at every layer.
 */
export type UserId = string & Brand.Brand<"UserId">;

const userIdBrand = Brand.nominal<UserId>();
const userIdSchema = z.string().min(1);

export const UserId = {
  parse(value: string): UserId {
    return userIdBrand(userIdSchema.parse(value));
  },
} as const;

export type RoleId = string & Brand.Brand<"RoleId">;

const roleIdBrand = Brand.nominal<RoleId>();
const roleIdSchema = z.string().min(1).max(120);

export const RoleId = {
  parse(value: string): RoleId {
    return roleIdBrand(roleIdSchema.parse(value));
  },
} as const;

/**
 * Non-authenticating session record reference. The bearer token never
 * crosses into application code, so revocation takes this branded id and
 * resolves the token server-side after an ownership check.
 */
export type SessionId = string & Brand.Brand<"SessionId">;

const sessionIdBrand = Brand.nominal<SessionId>();
const sessionIdSchema = z.string().min(1).max(255);

export const SessionId = {
  parse(value: string): SessionId {
    return sessionIdBrand(sessionIdSchema.parse(value));
  },
} as const;
