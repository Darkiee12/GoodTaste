import { Context, Effect, Layer } from "effect";

import type { DishServiceError } from "@/modules/food-discovery/server/operations/dish-service";
import { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import { FavoriteExists, FavoriteNotFound } from "@/modules/user/server/domain/errors";
import { UserRepository } from "@/modules/user/server/repository/user-repository";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";

export class ProfileService extends Context.Service<
  ProfileService,
  {
    readonly getProfile: (
      userId: string,
    ) => Effect.Effect<ProfileSummary | null, DatabaseError, Database>;
    readonly updateProfile: (input: {
      readonly userId: string;
      readonly displayName: string | null;
      readonly locale: string;
    }) => Effect.Effect<ProfileSummary, DatabaseError, Database>;
  }
>()("feastjourney/user/ProfileService") {}

/** Client-safe profile shape. Field names match the settings UI contract. */
export interface ProfileSummary {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly locale: string;
}

export const ProfileServiceLive = Layer.effect(
  ProfileService,
  Effect.gen(function* () {
    const repository = yield* UserRepository;

    return ProfileService.of({
      getProfile: (userId) => repository.profileByUserId(userId),
      updateProfile: (input) =>
        repository.upsertProfile({
          userId: input.userId,
          displayName: input.displayName,
          locale: input.locale,
        }),
    });
  }),
);

/** Client-safe favorite: string IDs for JSON serialization. */
export interface FavoriteSummary {
  readonly dish_id: string;
  readonly created_at: string;
}

export class FavoritesService extends Context.Service<
  FavoritesService,
  {
    readonly listFavorites: (
      userId: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<FavoriteSummary>, DatabaseError, Database>;
    readonly addFavorite: (
      userId: string,
      dishId: string,
    ) => Effect.Effect<
      FavoriteSummary,
      DishServiceError | DatabaseError | FavoriteExists,
      Database | DishService
    >;
    readonly removeFavorite: (
      userId: string,
      dishId: string,
    ) => Effect.Effect<void, DatabaseError | FavoriteNotFound, Database>;
  }
>()("feastjourney/user/FavoritesService") {}

export const FavoritesServiceLive = Layer.effect(
  FavoritesService,
  Effect.gen(function* () {
    const dishes = yield* DishService;
    const repository = yield* UserRepository;

    return FavoritesService.of({
      listFavorites: (userId, limit) => repository.favoritesByUserId(userId, limit),
      addFavorite: (userId, dishId) =>
        Effect.gen(function* () {
          yield* dishes.getDish(dishId, "en");

          const numericId = BigInt(dishId);
          const existing = yield* repository.favoriteByUserDish(userId, numericId);

          if (existing !== null) {
            return yield* new FavoriteExists({ dishId });
          }

          return yield* Effect.catchTag(
            repository.insertFavorite(userId, numericId),
            "PersistenceConflict",
            () => new FavoriteExists({ dishId }),
          );
        }),
      removeFavorite: (userId, dishId) =>
        Effect.gen(function* () {
          const numericId = BigInt(dishId);
          const existing = yield* repository.favoriteByUserDish(userId, numericId);

          if (existing === null) {
            return yield* new FavoriteNotFound({ dishId });
          }

          return yield* repository.deleteFavorite(userId, numericId);
        }),
    });
  }),
);
