import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Effect, Layer, ManagedRuntime } from "effect";

import type { DishSummary } from "@/modules/food-discovery/server/domain/dish";
import { CatalogServicesLive, RepositoriesLive } from "@/modules/food-discovery/server/index";
import { CatalogImportServiceLive } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationServiceLive } from "@/modules/food-discovery/server/operations/curation-service";
import {
  type RecommendDishesInput,
  RecommendationOutcome,
  RecommendationService,
  RecommendationServiceLive,
} from "@/modules/food-discovery/server/operations/recommendation-service";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import { DatabaseLive, type Database } from "@/server/database/client";
import { resetServerEnvCache } from "@/server/env";
import {
  MetaClient,
  type MetaError,
  MetaInvalidOutput,
  type MetaRankCandidate,
  type MetaRankContext,
  MetaRequestError,
} from "@/server/integrations/meta-client";

// Recommendation tests use the real database with a fake MetaClient injected
// per runtime. The live MetaClientLive is never provided, so no test can
// reach the network; fakes that must stay silent fail loudly if invoked.
const CurationLive = Layer.provide(CurationServiceLive, RepositoriesLive);

const DomainLive = Layer.provide(
  Layer.mergeAll(CatalogServicesLive, CatalogImportServiceLive),
  Layer.mergeAll(RepositoriesLive, CurationLive),
);

type RankImpl = (
  candidates: ReadonlyArray<MetaRankCandidate>,
  context: MetaRankContext,
) => Effect.Effect<ReadonlyArray<string>, MetaError>;

const makeRuntime = (rank: RankImpl) => {
  const fakeMeta = Layer.succeed(MetaClient, { rank });

  const recommendationLive = Layer.provide(
    RecommendationServiceLive,
    Layer.mergeAll(RepositoriesLive, fakeMeta),
  );

  return ManagedRuntime.make(
    Layer.mergeAll(
      DatabaseLive,
      RepositoriesLive,
      CurationLive,
      DomainLive,
      recommendationLive,
      fakeMeta,
    ),
  );
};

type TestRuntime = ReturnType<typeof makeRuntime>;

type TestServices = Database | IngredientRepository | RecommendationService | MetaClient;

const runtimes: Array<TestRuntime> = [];

const track = (runtime: TestRuntime): TestRuntime => {
  runtimes.push(runtime);

  return runtime;
};

const runOn = <A, E>(runtime: TestRuntime, effect: Effect.Effect<A, E, TestServices>): Promise<A> =>
  runtime.runPromise(effect);

const withModelKey = (key: string | undefined): void => {
  if (key === undefined) {
    delete process.env.MODEL_API_KEY;
  } else {
    process.env.MODEL_API_KEY = key;
  }

  resetServerEnvCache();
};

const baseInput: RecommendDishesInput = {
  meal: "anything",
  avoid: [],
  allergies: [],
  cuisine: undefined,
  country: undefined,
  mood: "any",
  locale: "en",
};

const modeOf = (outcome: RecommendationOutcome): string =>
  RecommendationOutcome.$match(outcome, {
    Ready: ({ mode }) => mode,
    Uncertain: () => "uncertain",
    Empty: () => "empty",
  });

const dishesOf = (outcome: RecommendationOutcome): Array<DishSummary> =>
  RecommendationOutcome.$match(outcome, {
    Ready: ({ dishes }) => [...dishes],
    Uncertain: () => [],
    Empty: () => [],
  });

const warningsOf = (outcome: RecommendationOutcome): Array<string> =>
  RecommendationOutcome.$match(outcome, {
    Ready: ({ warnings }) => [...warnings],
    Uncertain: () => [],
    Empty: () => [],
  });

const reasonsOf = (outcome: RecommendationOutcome): Array<string> =>
  RecommendationOutcome.$match(outcome, {
    Ready: () => [],
    Uncertain: ({ reasons }) => [...reasons],
    Empty: ({ reasons }) => [...reasons],
  });

const recommendOn = (runtime: TestRuntime, input: RecommendDishesInput) =>
  runOn(
    runtime,
    Effect.flatMap(RecommendationService, (service) => service.recommend(input)),
  );

const silentRank =
  (counter: { calls: number }): RankImpl =>
  () => {
    counter.calls += 1;

    return Effect.fail(new MetaRequestError({ reason: "MetaClient must not be called" }));
  };

describe("dish recommendations", () => {
  test("serves the deterministic baseline without an API key", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, baseInput);

    expect(modeOf(outcome)).toBe("deterministic");
    expect(counter.calls).toBe(0);

    const dishes = dishesOf(outcome);
    expect(dishes).toHaveLength(10);

    const slugs = dishes.map((dish) => dish.slug);
    expect(slugs).toContain("pho");

    const warnings = warningsOf(outcome);
    expect(warnings.some((warning) => warning.includes("not configured"))).toBe(true);

    const again = await recommendOn(runtime, baseInput);
    expect(dishesOf(again).map((dish) => dish.id)).toEqual(dishes.map((dish) => dish.id));
  });

  test("excludes dishes with avoided ingredients", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const resolved = await runOn(
      runtime,
      Effect.flatMap(IngredientRepository, (repository) =>
        repository.resolveByKey("beef", "en", 1),
      ),
    );

    expect(resolved.length).toBeGreaterThan(0);

    const outcome = await recommendOn(runtime, { ...baseInput, avoid: ["beef"] });
    const slugs = dishesOf(outcome).map((dish) => dish.slug);

    expect(slugs).not.toContain("pho");
    expect(slugs).not.toContain("pho-bo");
    expect(modeOf(outcome)).toBe("deterministic");
  });

  test("applies cuisine and country filters", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const vietnamese = await recommendOn(runtime, { ...baseInput, cuisine: "vietnamese" });
    const vietnameseSlugs = dishesOf(vietnamese).map((dish) => dish.slug);
    expect(vietnameseSlugs).toContain("pho");
    expect(vietnameseSlugs).not.toContain("sushi");

    const japanese = await recommendOn(runtime, { ...baseInput, cuisine: "japanese" });
    const japaneseSlugs = dishesOf(japanese).map((dish) => dish.slug);
    expect(japaneseSlugs).toContain("sushi");
    expect(japaneseSlugs).not.toContain("pho");

    const vietnam = await recommendOn(runtime, { ...baseInput, country: "VN" });
    const vietnamSlugs = dishesOf(vietnam).map((dish) => dish.slug);
    expect(vietnamSlugs).toContain("pho");
  });

  test("respects the candidate cap", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    process.env.MODEL_CANDIDATE_LIMIT = "3";
    resetServerEnvCache();

    try {
      const outcome = await recommendOn(runtime, baseInput);
      expect(dishesOf(outcome).length).toBeLessThanOrEqual(3);
    } finally {
      delete process.env.MODEL_CANDIDATE_LIMIT;
      resetServerEnvCache();
    }
  });

  test("returns Uncertain for unresolvable allergies without ranking", async () => {
    withModelKey("test-key");
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, {
      ...baseInput,
      allergies: ["unobtainium-xyz"],
    });

    expect(modeOf(outcome)).toBe("uncertain");
    expect(dishesOf(outcome)).toEqual([]);
    expect(reasonsOf(outcome).length).toBeGreaterThan(0);
    expect(counter.calls).toBe(0);
  });

  test("ignores unknown dislikes with a warning", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, {
      ...baseInput,
      avoid: ["unobtainium-xyz"],
    });

    expect(modeOf(outcome)).toBe("deterministic");
    expect(dishesOf(outcome).length).toBeGreaterThan(0);
    expect(warningsOf(outcome).some((warning) => warning.includes("Ignored unknown dislike"))).toBe(
      true,
    );
  });

  test("warns that ingredient data is not an allergy guarantee", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, { ...baseInput, allergies: ["beef"] });
    const slugs = dishesOf(outcome).map((dish) => dish.slug);

    expect(slugs).not.toContain("pho");
    expect(slugs).not.toContain("pho-bo");
    expect(
      warningsOf(outcome).some((warning) => warning.includes("not an allergy guarantee")),
    ).toBe(true);
  });

  test("ranks with the fake AI client and hydrates from candidate rows", async () => {
    withModelKey("test-key");
    let calls = 0;
    let candidateKeys: Array<string> = [];
    let expectedIds: Array<string> = [];

    const runtime = track(
      makeRuntime((candidates, context) => {
        calls += 1;
        const first = candidates[0];

        if (first !== undefined) {
          candidateKeys = Object.keys(first).toSorted();
        }

        expectedIds = candidates
          .slice(0, 3)
          .toReversed()
          .map((candidate) => candidate.id);

        expect(context.occasion).toBe("dinner");
        expect(context.mood).toBe("comforting");

        return Effect.succeed(expectedIds);
      }),
    );

    const outcome = await recommendOn(runtime, {
      ...baseInput,
      meal: "dinner",
      mood: "comforting",
    });

    expect(modeOf(outcome)).toBe("ai");
    expect(calls).toBe(1);
    expect(candidateKeys).toEqual(["categories", "cuisines", "description", "id", "name"]);

    const dishes = dishesOf(outcome);
    expect(dishes).toHaveLength(3);
    expect(dishes.map((dish) => dish.id)).toEqual(expectedIds);
    expect(dishes[0]?.name).toBeDefined();
    expect(dishes[0]?.slug.length).toBeGreaterThan(0);
    expect(dishes[0]?.categorySlugs.length).toBeGreaterThan(0);
  });

  test("falls back to deterministic order on invalid AI output", async () => {
    withModelKey(undefined);
    const silent = track(makeRuntime(silentRank({ calls: 0 })));
    const baseline = dishesOf(await recommendOn(silent, baseInput)).map((dish) => dish.id);
    expect(baseline.length).toBeGreaterThan(0);

    withModelKey("test-key");

    const cases: Array<{ name: string; rank: RankImpl }> = [
      {
        name: "duplicate ids",
        rank: (candidates) => Effect.succeed([candidates[0]?.id ?? "", candidates[0]?.id ?? ""]),
      },
      {
        name: "unknown id",
        rank: () => Effect.succeed(["999999999"]),
      },
      {
        name: "too many ids",
        rank: (candidates) => Effect.succeed(candidates.slice(0, 11).map((c) => c.id)),
      },
      {
        name: "empty ranking",
        rank: () => Effect.succeed([]),
      },
      {
        name: "invalid output",
        rank: () => Effect.fail(new MetaInvalidOutput({ reason: "canned malformed payload" })),
      },
      {
        name: "request error",
        rank: () => Effect.fail(new MetaRequestError({ reason: "canned 401", status: 401 })),
      },
      {
        name: "timeout",
        rank: () => Effect.fail(new MetaRequestError({ reason: "canned timeout" })),
      },
    ];

    const checkFallback = async (entry: { name: string; rank: RankImpl }) => {
      const runtime = track(makeRuntime(entry.rank));
      const outcome = await recommendOn(runtime, baseInput);

      expect(modeOf(outcome), entry.name).toBe("deterministic");
      expect(dishesOf(outcome).map((dish) => dish.id)).toEqual(baseline);
      expect(warningsOf(outcome).some((warning) => warning.includes("deterministic order"))).toBe(
        true,
      );
    };

    await Promise.all(cases.map((entry) => checkFallback(entry)));
  });

  test("returns Empty when no dishes match", async () => {
    withModelKey("test-key");
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, { ...baseInput, cuisine: "ethiopian" });

    expect(modeOf(outcome)).toBe("empty");
    expect(dishesOf(outcome)).toEqual([]);
    expect(reasonsOf(outcome).length).toBeGreaterThan(0);
    expect(counter.calls).toBe(0);
  });

  test("returns the whole pool when fewer than ten dishes match", async () => {
    withModelKey(undefined);
    const counter = { calls: 0 };
    const runtime = track(makeRuntime(silentRank(counter)));

    const outcome = await recommendOn(runtime, { ...baseInput, cuisine: "japanese" });
    const slugs = dishesOf(outcome).map((dish) => dish.slug);

    expect(modeOf(outcome)).toBe("deterministic");
    expect(slugs).toHaveLength(2);
    expect(slugs).toContain("sushi");
    expect(slugs).toContain("ramen");
  });
});

beforeAll(() => {
  expect(process.env.DATABASE_URL).toBeDefined();
  withModelKey(undefined);
});

afterAll(async () => {
  withModelKey(undefined);

  await Promise.all(runtimes.map((runtime) => runtime.dispose()));
});
