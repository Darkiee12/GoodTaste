import { Schema } from "effect";

import {
  IngredientRole,
  LanguageTag,
  NameKind,
  PlaceAssociation,
  Slug,
} from "@/modules/food-discovery/server/domain/ids";

const boundedText = (min: number, max: number) =>
  Schema.String.pipe(Schema.check(Schema.isMinLength(min), Schema.isMaxLength(max)));

export const AuthoringName = Schema.Struct({
  language_tag: LanguageTag,
  name: boundedText(1, 300),
  name_kind: NameKind,
});

export type AuthoringName = typeof AuthoringName.Type;

export const AuthoringDescription = Schema.Struct({
  language_tag: LanguageTag,
  description: boundedText(1, 20000),
  summary: Schema.NullOr(boundedText(1, 1000)),
});

export type AuthoringDescription = typeof AuthoringDescription.Type;

export const AuthoringIngredient = Schema.Struct({
  name: boundedText(1, 300),
  language_tag: Schema.optional(LanguageTag),
  role: IngredientRole,
});

export type AuthoringIngredient = typeof AuthoringIngredient.Type;

export const AuthoringPlace = Schema.Struct({
  iso: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/))),
  ),
  place_id: Schema.optional(Schema.String),
  association: PlaceAssociation,
  note: Schema.optional(boundedText(1, 2000)),
});

export type AuthoringPlace = typeof AuthoringPlace.Type;

export const AuthoringDish = Schema.Struct({
  slug: Schema.optional(Slug),
  status: Schema.optional(Schema.Literals(["draft", "review"])),
  parent_slug: Schema.optional(Slug),
  names: Schema.NonEmptyArray(AuthoringName),
  descriptions: Schema.optional(Schema.Array(AuthoringDescription)),
  ingredients: Schema.optional(Schema.Array(AuthoringIngredient)),
  places: Schema.optional(Schema.Array(AuthoringPlace)),
  cuisines: Schema.optional(Schema.Array(Schema.String)),
  categories: Schema.optional(Schema.Array(Schema.String)),
  editorial_note: Schema.optional(boundedText(1, 2000)),
});

export type AuthoringDish = typeof AuthoringDish.Type;

export const ImportPayload = Schema.Struct({
  source_name: boundedText(1, 200),
  records: Schema.Array(AuthoringDish).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
});

export type ImportPayload = typeof ImportPayload.Type;

export const ImportRecordPayload = Schema.Struct({
  slug: Schema.optional(Schema.String),
  names: Schema.Array(AuthoringName),
});

export type ImportRecordPayload = typeof ImportRecordPayload.Type;

export const StoredImportRecord = Schema.Struct({
  record: AuthoringDish,
  duplicateOf: Schema.NullOr(Schema.String),
});

export type StoredImportRecord = typeof StoredImportRecord.Type;
