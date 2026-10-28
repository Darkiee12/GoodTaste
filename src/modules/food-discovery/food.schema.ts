import { z } from "zod";

import {
  MEAL_OCCASIONS,
  RECOMMENDATION_MOODS,
} from "@/modules/food-discovery/recommendation.constants";

export const localeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/, "locale must be a BCP 47 tag")
  .default("en");

export const languageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/, "language_tag must be a BCP 47 tag");

export const dbIdSchema = z.string().regex(/^[0-9]+$/, "id must be a decimal id string");

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase alphanumeric with hyphens")
  .max(120);

const modeSchema = z.enum(["any", "all"]).default("any");

export const dishSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  locale: localeSchema,
  ingredient: z.array(z.string()).optional(),
  ingredient_mode: modeSchema,
  category: z.array(z.string()).optional(),
  category_mode: modeSchema,
  cuisine: z.string().max(80).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, "country must be an ISO 3166 code")
    .optional(),
  region: dbIdSchema.optional(),
  place: dbIdSchema.optional(),
  association: z.enum(["origin", "associated", "popular"]).optional(),
  sort: z.enum(["relevance", "recent"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export type DishSearchQuery = z.infer<typeof dishSearchQuerySchema>;

export const dishDetailParamsSchema = z.object({
  id: z.string().min(1).max(120),
  locale: localeSchema,
});

export const dishBatchQuerySchema = z.object({
  ids: z.array(dbIdSchema).min(1).max(50),
  locale: localeSchema,
});

export const relatedQuerySchema = z.object({
  locale: localeSchema,
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const nameSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  locale: localeSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const placeQuerySchema = z.object({
  locale: localeSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Country chooser bound: all ISO countries fit well under this cap. */
export const countryQuerySchema = z.object({
  locale: localeSchema,
  limit: z.coerce.number().int().min(1).max(300).default(250),
});

export const placeDishesQuerySchema = z.object({
  locale: localeSchema,
  association: z.enum(["origin", "associated", "popular"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const mealSchema = z.enum(MEAL_OCCASIONS).default("anything");

const recommendationMoodSchema = z.enum(RECOMMENDATION_MOODS).default("any");

export const recommendationQuerySchema = z.object({
  meal: mealSchema,
  avoid: z.array(z.string().max(100)).max(20).default([]),
  allergies: z.array(z.string().max(100)).max(20).default([]),
  cuisine: z.string().max(80).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, "country must be an ISO 3166 code")
    .optional(),
  mood: recommendationMoodSchema,
  locale: localeSchema,
  surpriseSeed: z.number().int().min(0).max(2147483647).default(0),
});

export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;

const nameKindSchema = z.enum(["native", "localized", "alias", "transliteration"]);

export const adminNameSchema = z.object({
  language_tag: languageTagSchema,
  name: z.string().trim().min(1).max(300),
  name_kind: nameKindSchema,
});

export const adminCreateDishSchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(["draft", "review", "published", "archived"]).default("draft"),
  parent_slug: slugSchema.optional(),
  names: z.array(adminNameSchema).min(1).max(20),
});

export const adminUpdateDishSchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(["draft", "review", "published", "archived"]).optional(),
  parent_slug: slugSchema.nullable().default(null),
});

export const adminStatusSchema = z.object({
  status: z.enum(["draft", "review", "published", "archived"]),
});

export const adminDescriptionSchema = z.object({
  language_tag: languageTagSchema,
  description: z.string().min(1).max(20000),
  summary: z.string().max(1000).nullable().default(null),
});

export const adminIngredientLinkSchema = z.object({
  ingredient_id: dbIdSchema,
  role: z.enum(["core", "common", "optional", "garnish"]),
});

export const adminPlaceLinkSchema = z.object({
  place_id: dbIdSchema,
  association: z.enum(["origin", "associated", "popular"]),
  is_disputed: z.boolean().default(false),
});

export const adminCategoryLinkSchema = z.object({
  category_slug: z.string().min(1).max(80),
});

export const adminCuisineLinkSchema = z.object({
  cuisine_slug: z.string().min(1).max(80),
});

export const adminNoteSchema = z.object({
  author: z.string().trim().min(1).max(200),
  note_kind: z.enum(["review", "correction", "question"]),
  note: z.string().trim().min(1).max(5000),
});

export const reviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export const adminImportValidateSchema = z.object({
  source_name: z.string().trim().min(1).max(200),
  records: z.array(z.unknown()).min(1).max(100),
});

export const adminImportApplySchema = z.object({
  job_id: dbIdSchema,
  approvals: z.object({
    license_ack: z.boolean(),
    review_ack: z.boolean(),
    duplicate_refs: z.array(z.string().min(1).max(300)),
  }),
});
