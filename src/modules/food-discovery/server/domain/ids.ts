import { Schema } from "effect";

const BIGINT_PATTERN = /^[0-9]+$/;

const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,8})?$/;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const DishId = Schema.String.pipe(Schema.brand("DishId"));

export type DishId = typeof DishId.Type;

export const IngredientId = Schema.String.pipe(Schema.brand("IngredientId"));

export type IngredientId = typeof IngredientId.Type;

export const PlaceId = Schema.String.pipe(Schema.brand("PlaceId"));

export type PlaceId = typeof PlaceId.Type;

export const CategoryId = Schema.String.pipe(Schema.brand("CategoryId"));

export type CategoryId = typeof CategoryId.Type;

export const CuisineId = Schema.String.pipe(Schema.brand("CuisineId"));

export type CuisineId = typeof CuisineId.Type;

export const LanguageTag = Schema.String.pipe(
  Schema.check(Schema.isPattern(LOCALE_PATTERN)),
  Schema.brand("LanguageTag"),
);

export type LanguageTag = typeof LanguageTag.Type;

export const Slug = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN)),
  Schema.brand("Slug"),
);

export type Slug = typeof Slug.Type;

export const DishStatus = Schema.Literals(["draft", "review", "published", "archived"]);

export type DishStatus = typeof DishStatus.Type;

export const IngredientRole = Schema.Literals(["core", "common", "optional", "garnish"]);

export type IngredientRole = typeof IngredientRole.Type;

export const PlaceAssociation = Schema.Literals(["origin", "associated", "popular"]);

export type PlaceAssociation = typeof PlaceAssociation.Type;

export const NameKind = Schema.Literals(["native", "localized", "alias", "transliteration"]);

export type NameKind = typeof NameKind.Type;

export const encodeDbId = (id: bigint): string => id.toString();

export const decodeDbId = (id: string): bigint => BigInt(id);

export const isDbIdString = (value: string): boolean => BIGINT_PATTERN.test(value);

export const isLanguageTag = (value: string): boolean => LOCALE_PATTERN.test(value);

export const isSlug = (value: string): boolean => SLUG_PATTERN.test(value);

const SLUG_CLEANUP = /[^a-z0-9]+/g;

/**
 * Derives an application-owned canonical slug from a display name. The slug
 * is opaque identity, never a factual claim; collisions are resolved by the
 * caller with a numeric suffix.
 */
export const slugifyName = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(SLUG_CLEANUP, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug.length === 0 ? "dish" : slug;
};
