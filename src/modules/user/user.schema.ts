import { z } from "zod";

/**
 * Client-safe transport schemas for the user module. Identity, roles, and
 * verification state never come from these schemas; they come from the
 * verified server session.
 */
export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(100).nullable().default(null),
  locale: z.enum(["en", "vi", "hi", "es", "zh"]).default("en"),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const favoriteLinkSchema = z.object({
  dish_id: z.string().regex(/^[0-9]+$/, "dish_id must be a decimal id string"),
});

export type FavoriteLink = z.infer<typeof favoriteLinkSchema>;

export const favoritesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sessionRevokeSchema = z.object({
  session_id: z.string().min(1).max(255),
});

export const unlinkAccountSchema = z.object({
  account_id: z.string().min(1).max(255),
});

export const adminRoleAssignSchema = z.object({
  user_id: z.string().min(1).max(255),
  role_id: z.string().min(1).max(120),
});

export const adminUserQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
