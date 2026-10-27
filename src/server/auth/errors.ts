import { Data } from "effect";

export class SignInRequired extends Data.TaggedError("SignInRequired")<{
  readonly required: "member";
}> {}

export class Forbidden extends Data.TaggedError("Forbidden")<{
  readonly reason: string;
}> {}

export class AdminRequired extends Data.TaggedError("AdminRequired")<{
  readonly reason: string;
}> {}
