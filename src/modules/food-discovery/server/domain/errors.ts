import { Data } from "effect";

export class DishNotFound extends Data.TaggedError("DishNotFound")<{
  readonly dishId: string;
}> {}

export class IngredientNotFound extends Data.TaggedError("IngredientNotFound")<{
  readonly ingredientId: string;
}> {}

export class PlaceNotFound extends Data.TaggedError("PlaceNotFound")<{
  readonly placeId: string;
}> {}

export class InvalidSearchFilter extends Data.TaggedError("InvalidSearchFilter")<{
  readonly reason: string;
}> {}

export class InvalidLocale extends Data.TaggedError("InvalidLocale")<{
  readonly locale: string;
}> {}

export class ConflictingDish extends Data.TaggedError("ConflictingDish")<{
  readonly reason: string;
}> {}

export class InvalidDishData extends Data.TaggedError("InvalidDishData")<{
  readonly reason: string;
}> {}

export class CatalogConflict extends Data.TaggedError("CatalogConflict")<{
  readonly reason: string;
}> {}

export class InvalidRelationship extends Data.TaggedError("InvalidRelationship")<{
  readonly reason: string;
}> {}
