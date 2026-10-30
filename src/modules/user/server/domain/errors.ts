import { Data } from "effect";

export class FavoriteExists extends Data.TaggedError("FavoriteExists")<{
  readonly dishId: string;
}> {}

export class FavoriteNotFound extends Data.TaggedError("FavoriteNotFound")<{
  readonly dishId: string;
}> {}

export class UnlinkDenied extends Data.TaggedError("UnlinkDenied")<{
  readonly reason: string;
}> {}
