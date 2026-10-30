import { Data } from "effect";

export type Actor = Data.TaggedEnum<{
  Guest: {};
  Member: { readonly userId: string };
}>;

export const Actor = Data.taggedEnum<Actor>();

export const describeActor = (actor: Actor): string =>
  Actor.$match(actor, {
    Guest: () => "guest",
    Member: ({ userId }) => `member:${userId}`,
  });
