import { Data, Predicate } from "effect";

export type Actor = Data.TaggedEnum<{
  Guest: {};
  Member: { readonly userId: string };
  Admin: { readonly userId: string };
}>;

export const Actor = Data.taggedEnum<Actor>();

export const describeActor = (actor: Actor): string =>
  Actor.$match(actor, {
    Guest: () => "guest",
    Member: ({ userId }) => `member:${userId}`,
    Admin: ({ userId }) => `admin:${userId}`,
  });

export const isAdmin = (actor: Actor): boolean => Predicate.isTagged(actor, "Admin");
