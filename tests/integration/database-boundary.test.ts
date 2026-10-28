import { afterAll, describe, expect, test } from "bun:test";

import { Effect, Layer, ManagedRuntime } from "effect";
import postgres from "postgres";

import { CatalogServicesLive, RepositoriesLive } from "@/modules/food-discovery/server/index";
import { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import { CatalogImportServiceLive } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationServiceLive } from "@/modules/food-discovery/server/operations/curation-service";
import {
  DishService,
  DishServiceLive,
} from "@/modules/food-discovery/server/operations/dish-service";
import { DishRelationsRepositoryLive } from "@/modules/food-discovery/server/repository/dish-relations-repository";
import {
  DishRepository,
  DishRepositoryLive,
} from "@/modules/food-discovery/server/repository/dish-repository";
import { IngredientRepositoryLive } from "@/modules/food-discovery/server/repository/ingredient-repository";
import {
  PlaceRepository,
  PlaceRepositoryLive,
} from "@/modules/food-discovery/server/repository/place-repository";
import { TaxonomyRepositoryLive } from "@/modules/food-discovery/server/repository/taxonomy-repository";
import { Database, DatabaseLive, withTransaction } from "@/server/database/client";

import { createdSlugs } from "./cleanup";

// Food-discovery-only composition: the shared AppLive currently includes the
// in-progress user module and cannot build, so boundary tests run the exact
// food-discovery layers instead of depending on unrelated work.
const CurationLive = Layer.provide(CurationServiceLive, RepositoriesLive);

const DomainLive = Layer.provide(
  Layer.mergeAll(CatalogServicesLive, CatalogImportServiceLive),
  Layer.mergeAll(RepositoriesLive, CurationLive),
);

const FoodDiscoveryLive = Layer.mergeAll(DatabaseLive, RepositoriesLive, CurationLive, DomainLive);
const testRuntime = ManagedRuntime.make(FoodDiscoveryLive);

type TestServices = Database | DishService | AdminService | PlaceRepository | DishRepository;

const run = <A, E>(effect: Effect.Effect<A, E, TestServices>): Promise<A> =>
  testRuntime.runPromise(effect);

const flipRun = <A, E>(effect: Effect.Effect<A, E, TestServices>): Promise<E> =>
  testRuntime.runPromise(Effect.flip(effect));

const slug = `test-boundary-${Date.now().toString(36)}`;
let dishId = "";

describe("database execution boundary", () => {
  test("round-trips a created dish and reports absent records as null", async () => {
    createdSlugs.push(slug);

    const created = await run(
      Effect.flatMap(AdminService, (service) =>
        service.createDish("test", {
          slug,
          status: "draft",
          names: [{ languageTag: "en", name: "Boundary Test Dish", nameKind: "native" }],
        }),
      ),
    );

    dishId = created.id;

    expect(created.slug).toBe(slug);

    const byId = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.findById(BigInt(dishId))),
    );

    expect(byId?.slug).toBe(slug);

    const bySlug = await run(Effect.flatMap(DishRepository, (dishes) => dishes.findBySlug(slug)));
    expect(bySlug?.slug).toBe(slug);

    const missing = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.findById(999_999_999n)),
    );

    expect(missing).toBeNull();

    const missingStatus = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.updateStatus(999_999_999n, "draft")),
    );

    expect(missingStatus).toBeNull();

    const missingIso = await run(
      Effect.flatMap(PlaceRepository, (places) => places.findByIso("ZZ")),
    );

    expect(missingIso).toBeNull();
  });

  test("resolves a country iso to a single deterministic place", async () => {
    const place = await run(Effect.flatMap(PlaceRepository, (places) => places.findByIso("VN")));

    expect(place).not.toBeNull();
    expect(place?.iso3166).toBe("VN");
    expect(place?.kind).toBe("country");
  });

  test("pages published dishes by id with stable order and no overlap", async () => {
    const first = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.listByStatus("published", 0n, 5)),
    );

    const lastId = first[first.length - 1]?.id;

    expect(first.length).toBeGreaterThan(0);
    expect(lastId).toBeDefined();

    const second = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.listByStatus("published", lastId ?? 0n, 5)),
    );

    const firstIds = first.map((row) => row.id);
    const secondIds = second.map((row) => row.id);
    const combined = [...firstIds, ...secondIds];

    const ascending = combined.toSorted((a, b) => {
      if (a < b) {
        return -1;
      }

      return a > b ? 1 : 0;
    });

    expect(new Set(combined).size).toBe(firstIds.length + secondIds.length);
    expect(combined).toEqual(ascending);
  });

  test("preserves nullable place fields instead of normalizing them away", async () => {
    const rows = await run(Effect.flatMap(PlaceRepository, (places) => places.listWithNames(200)));
    const withoutIso = rows.find((row) => row.iso3166 === null);

    expect(rows.length).toBeGreaterThan(0);
    expect(withoutIso?.iso3166).toBeNull();
  });

  test("maps duplicate dish slugs to a conflict via SQLSTATE 23505", async () => {
    const duplicateSlug = `test-duplicate-${Date.now().toString(36)}`;
    createdSlugs.push(duplicateSlug);

    await run(
      Effect.flatMap(DishRepository, (dishes) =>
        dishes.insert({ slug: duplicateSlug, parentDishId: null, status: "draft" }),
      ),
    );

    const failure = await flipRun(
      Effect.flatMap(DishRepository, (dishes) =>
        dishes.insert({ slug: duplicateSlug, parentDishId: null, status: "draft" }),
      ),
    );

    expect(failure._tag).toBe("PersistenceConflict");
    expect(failure).toMatchObject({ operation: "dish/insert", constraint: "dishes_slug_uidx" });
  });

  test("rolls back multi-statement transactions atomically", async () => {
    const rollbackSlug = `test-rollback-${Date.now().toString(36)}`;
    let thrown: Error | null = null;

    try {
      await run(
        withTransaction(
          "test/atomic",
          Effect.flatMap(DishRepository, (dishes) =>
            Effect.flatMap(
              dishes.insert({ slug: rollbackSlug, parentDishId: null, status: "draft" }),
              () => Effect.fail(new Error("boom")),
            ),
          ),
        ),
      );
    } catch (error) {
      thrown = error instanceof Error ? error : null;
    }

    expect(thrown?.message).toBe("boom");

    const rolledBack = await run(
      Effect.flatMap(DishRepository, (dishes) => dishes.findBySlug(rollbackSlug)),
    );

    expect(rolledBack).toBeNull();
  });

  test("propagates a connection outage as DatabaseUnavailable", async () => {
    const down = postgres("postgres://127.0.0.1:54339/unused", { connect_timeout: 2, max: 1 });
    const deadDatabase = Layer.succeed(Database, { sql: down });

    const deadRepos = Layer.mergeAll(
      Layer.provide(DishRepositoryLive, deadDatabase),
      Layer.provide(DishRelationsRepositoryLive, deadDatabase),
      Layer.provide(IngredientRepositoryLive, deadDatabase),
      Layer.provide(PlaceRepositoryLive, deadDatabase),
      Layer.provide(TaxonomyRepositoryLive, deadDatabase),
    );

    const deadDish = Layer.provide(DishServiceLive, deadRepos);

    try {
      const failure = await Effect.runPromise(
        Effect.provide(
          Effect.flip(
            Effect.flatMap(DishService, (service) =>
              service.searchDishes({ locale: "en", limit: 5 }),
            ),
          ),
          Layer.mergeAll(deadDish, deadDatabase),
        ),
      );

      expect(failure._tag).toBe("DatabaseUnavailable");
    } finally {
      await down.end();
    }
  });
});

afterAll(async () => {
  await testRuntime.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;

      for (const candidate of createdSlugs) {
        yield* Effect.tryPromise({
          try: () => db.sql`DELETE FROM feastjourney.dishes WHERE slug = ${candidate}`,
          catch: () => new Error("cleanup failed"),
        });
      }
    }),
  );
  await testRuntime.dispose();
});
