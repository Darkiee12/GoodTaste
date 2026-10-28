import { Context, Data, Effect, Layer } from "effect";

import type {
  MealOccasion,
  RecommendationMood,
} from "@/modules/food-discovery/recommendation.constants";
import type { DishSummary } from "@/modules/food-discovery/server/domain/dish";
import { InvalidLocale } from "@/modules/food-discovery/server/domain/errors";
import { isLanguageTag } from "@/modules/food-discovery/server/domain/ids";
import { normalizeSearchKey } from "@/modules/food-discovery/server/domain/search";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import dishRecommendationCandidates from "@/modules/food-discovery/server/repository/sql/dish-recommendation-candidates.sql";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";
import { runQuery } from "@/server/database/query";
import { RankingConfig, resolveRankingConfig, serverEnv } from "@/server/env";
import {
  MetaClient,
  type MetaAuthError,
  MetaInvalidOutput,
  type MetaPermanentError,
  type MetaRateLimited,
  type MetaRequestError,
  type MetaRankCandidate,
  type MuseRankingConfig,
  RankingFailureDisposition,
  dispositionForMetaError,
} from "@/server/integrations/meta-client";

export type RecommendationCandidateRow = (typeof dishRecommendationCandidates)["~reylo"]["element"];

export type RecommendationOutcome = Data.TaggedEnum<{
  ReadyMuse: {
    readonly dishes: ReadonlyArray<DishSummary>;
    readonly warnings: ReadonlyArray<string>;
  };
  ReadyDeterministic: {
    readonly dishes: ReadonlyArray<DishSummary>;
    readonly warnings: ReadonlyArray<string>;
  };
  Uncertain: { readonly reasons: ReadonlyArray<string> };
  Empty: { readonly reasons: ReadonlyArray<string> };
}>;

export const RecommendationOutcome = Data.taggedEnum<RecommendationOutcome>();

/** Typed operator error: muse was requested but key/model/baseUrl is unusable. */
export class RecommendationMisconfigured extends Data.TaggedError("RecommendationMisconfigured")<{
  readonly reason: string;
}> {}

/** Intermediate provider result before hydration into dish summaries. */
export type MuseRankResult = Data.TaggedEnum<{
  Ranked: { readonly ids: ReadonlyArray<string> };
  Degraded: { readonly ids: ReadonlyArray<string>; readonly warning: string };
}>;

export const MuseRankResult = Data.taggedEnum<MuseRankResult>();

/**
 * Client-safe wire envelope. The transport returns HTTP 200 with exactly this
 * shape for every outcome; provider/auth/config failures reject instead and
 * surface as HTTP 500. Asserted per-variant in
 * tests/integration/recommendation.test.ts.
 */
export interface RecommendationWireOutcome {
  readonly mode: "ai" | "deterministic" | "uncertain" | "empty";
  readonly dishes: Array<DishSummary>;
  readonly warnings: Array<string>;
  readonly reasons: Array<string>;
}

/** Exhaustive outcome-to-wire mapping; the transport handler delegates here. */
export const toWireOutcome = (outcome: RecommendationOutcome): RecommendationWireOutcome =>
  RecommendationOutcome.$match(outcome, {
    ReadyMuse: ({ dishes, warnings }) => ({
      mode: "ai" as const,
      dishes: [...dishes],
      warnings: [...warnings],
      reasons: [],
    }),
    ReadyDeterministic: ({ dishes, warnings }) => ({
      mode: "deterministic" as const,
      dishes: [...dishes],
      warnings: [...warnings],
      reasons: [],
    }),
    Uncertain: ({ reasons }) => ({
      mode: "uncertain" as const,
      dishes: [],
      warnings: [],
      reasons: [...reasons],
    }),
    Empty: ({ reasons }) => ({
      mode: "empty" as const,
      dishes: [],
      warnings: [],
      reasons: [...reasons],
    }),
  });

export interface RecommendDishesInput {
  readonly meal: MealOccasion;
  readonly avoid: ReadonlyArray<string>;
  readonly allergies: ReadonlyArray<string>;
  readonly cuisine?: string | undefined;
  readonly country?: string | undefined;
  readonly mood: RecommendationMood;
  readonly locale: string;
  readonly surpriseSeed: number;
}

export type RecommendationError =
  | InvalidLocale
  | DatabaseError
  | RecommendationMisconfigured
  | MetaAuthError
  | MetaPermanentError;

export class RecommendationService extends Context.Service<
  RecommendationService,
  {
    readonly recommend: (
      input: RecommendDishesInput,
    ) => Effect.Effect<
      RecommendationOutcome,
      RecommendationError,
      Database | IngredientRepository | MetaClient
    >;
  }
>()("feastjourney/food-discovery/RecommendationService") {}

// The catalog has no verified-completeness representation for ingredients, so
// allergy claims can never be proven; any allergy input refuses to rank.
const INCOMPLETE_DATA_EXPLANATION =
  "Ingredient data may be incomplete and carries no verified-completeness guarantee.";

const AI_NOT_CONFIGURED_NOTE = "Deterministic mode: AI ranking is not configured.";

const unixSeconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const compareIds = (left: string, right: string): number => {
  const leftId = BigInt(left);
  const rightId = BigInt(right);

  if (leftId < rightId) {
    return -1;
  }

  return leftId > rightId ? 1 : 0;
};

const nonNullStrings = (values: ReadonlyArray<string | null>): Array<string> =>
  values.filter((value): value is string => value !== null);

/**
 * Semantic card assembly, not a mechanical DTO copy: selects the localized
 * card fields out of the wider ranking projection (which also carries
 * description + ingredient names for the model), derives lastUpdate, and
 * records the absence of regional display data explicitly instead of
 * fabricating it. Row shape stays Reylo-inferred; this function only
 * projects it into the published DishSummary contract.
 */
const toSummary = (row: RecommendationCandidateRow): DishSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  englishName: row.englishName ?? undefined,
  regionNames: [],
  categorySlugs: nonNullStrings(row.categories),
  updatedAt: row.updatedAt,
  lastUpdate: unixSeconds(row.updatedAt),
});

const validateRankedIds = (
  ids: ReadonlyArray<string>,
  candidates: ReadonlyArray<RecommendationCandidateRow>,
  outputLimit: number,
): Effect.Effect<ReadonlyArray<string>, MetaInvalidOutput> =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return yield* new MetaInvalidOutput({ reason: "Meta ranking was empty" });
    }

    if (ids.length > outputLimit) {
      return yield* new MetaInvalidOutput({
        reason: `Meta ranking returned ${ids.length} dishes (limit ${outputLimit})`,
      });
    }

    const known = new Set(candidates.map((candidate) => candidate.id));
    const seen = new Set<string>();

    for (const id of ids) {
      if (!known.has(id)) {
        return yield* new MetaInvalidOutput({
          reason: "Meta ranking contained an unknown dish id",
        });
      }

      if (seen.has(id)) {
        return yield* new MetaInvalidOutput({
          reason: "Meta ranking contained duplicate ids",
        });
      }

      seen.add(id);
    }

    return ids;
  });

// Local relevance order. Mood-free by design: no catalog signal encodes
// mood suitability, so mood must not change this order (asserted in
// tests). Cuisine match outranks meal-category match, then id ASC keeps
// the order stable across seed changes. Mirrors the SQL ORDER BY so the
// candidate window and the final slice agree.
const rankDeterministic = (
  candidates: ReadonlyArray<RecommendationCandidateRow>,
  input: RecommendDishesInput,
  outputLimit: number,
): Array<RecommendationCandidateRow> => {
  const mealSlug = input.meal === "anything" ? null : input.meal;

  const scored = candidates.map((candidate) => {
    let score = 1;

    if (input.cuisine !== undefined && nonNullStrings(candidate.cuisines).includes(input.cuisine)) {
      score += 2;
    }

    if (mealSlug !== null && nonNullStrings(candidate.categories).includes(mealSlug)) {
      score += 1;
    }

    return { candidate, score };
  });

  scored.sort(
    (left, right) => right.score - left.score || compareIds(left.candidate.id, right.candidate.id),
  );

  return scored.slice(0, outputLimit).map((entry) => entry.candidate);
};

// Auth and permanent failures are observable: error log with status only (no
// keys/headers/prompts) and a loud failure that the server-fn transport
// surfaces as HTTP 500, never a silent deterministic downgrade.
const failLoudly = (
  config: MuseRankingConfig,
  error: MetaAuthError | MetaPermanentError,
): Effect.Effect<never, MetaAuthError | MetaPermanentError> =>
  Effect.logError("Recommendation ranking failed").pipe(
    Effect.annotateLogs({
      backend: "muse",
      modelId: config.modelId,
      failure: error._tag,
      status: error.status,
    }),
    Effect.andThen(Effect.fail(error)),
  );

// 429 cannot propagate Retry-After through the server-fn transport:
// returned Responses keep only allowlisted transport headers and
// Retry-After is stripped, so pretending to return 429 would lie.
// Degrade to deterministic order with a rate-limit warning instead.
// 5xx, timeouts, network failures, and invalid structured output
// degrade the same way with the generic unavailable warning.
const degradeToDeterministic = (
  config: MuseRankingConfig,
  deterministicIds: ReadonlyArray<string>,
  error: MetaRateLimited | MetaRequestError | MetaInvalidOutput,
): Effect.Effect<MuseRankResult> =>
  RankingFailureDisposition.$match(dispositionForMetaError(error), {
    // The classification table maps these three tags to Fallback; Fail here
    // would mean table and handler routing drifted, so die loudly.
    Fail: () => Effect.die(`Ranking disposition drift for ${error._tag}`),
    Fallback: ({ warning }) =>
      Effect.logWarning("Recommendation ranking degraded").pipe(
        Effect.annotateLogs({
          backend: "muse",
          modelId: config.modelId,
          failure: error._tag,
          fallbackReason: warning,
        }),
        Effect.andThen(Effect.succeed(MuseRankResult.Degraded({ ids: deterministicIds, warning }))),
      ),
  });

const rankWithMuse = (
  candidates: ReadonlyArray<RecommendationCandidateRow>,
  input: RecommendDishesInput,
  config: MuseRankingConfig,
  deterministicIds: ReadonlyArray<string>,
  outputLimit: number,
): Effect.Effect<MuseRankResult, MetaAuthError | MetaPermanentError, MetaClient> => {
  const rankInput: Array<MetaRankCandidate> = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    cuisines: nonNullStrings(candidate.cuisines),
    categories: nonNullStrings(candidate.categories),
    description: candidate.description,
  }));

  return Effect.flatMap(
    Effect.flatMap(MetaClient, (client) =>
      client
        .rank(
          rankInput,
          {
            occasion: input.meal,
            mood: input.mood,
            cuisineOrRegion: input.cuisine ?? input.country ?? null,
          },
          config,
        )
        .pipe(
          Effect.annotateLogs({
            backend: "muse",
            modelId: config.modelId,
            candidateCount: candidates.length,
          }),
        ),
    ),
    (ids) => validateRankedIds(ids, candidates, outputLimit),
  ).pipe(
    Effect.map((ids) => MuseRankResult.Ranked({ ids })),
    Effect.catchTags({
      MetaAuthError: (error) => failLoudly(config, error),
      MetaPermanentError: (error) => failLoudly(config, error),
      MetaRateLimited: (error) => degradeToDeterministic(config, deterministicIds, error),
      MetaRequestError: (error) => degradeToDeterministic(config, deterministicIds, error),
      MetaInvalidOutput: (error) => degradeToDeterministic(config, deterministicIds, error),
    }),
  );
};

interface RankingLimits {
  readonly candidateLimit: number;
  readonly outputLimit: number;
}

// Bounded Surprise rotation: stable order stays reproducible when the seed
// is 0; a nonzero seed rotates the ranked slice so repeated Surprise clicks
// vary without touching SQL eligibility, without ORDER BY random(), and
// without fetching the catalog into JavaScript. Rotation applies after
// ranking, so hard constraints (published, cuisine/region, ingredient
// anti-joins) and allergy refusals are unaffected.
const rotateForSurprise = <T>(items: ReadonlyArray<T>, seed: number): Array<T> => {
  if (items.length < 2 || seed === 0) {
    return [...items];
  }

  const offset = seed % items.length;

  if (offset === 0) {
    return [...items];
  }

  return [...items.slice(offset), ...items.slice(0, offset)];
};

const SURPRISE_NOTE = "Surprise variety applied: rotated the ranked dishes.";

const serveRecommendations = (
  input: RecommendDishesInput,
  warnings: ReadonlyArray<string>,
  excluded: ReadonlySet<bigint>,
  limits: RankingLimits,
  muse: MuseRankingConfig | null,
): Effect.Effect<RecommendationOutcome, RecommendationError, Database | MetaClient> =>
  Effect.gen(function* () {
    const candidates = yield* runQuery("dish/recommendation-candidates", (sql) =>
      dishRecommendationCandidates.run(sql, {
        cuisine: input.cuisine ?? null,
        country: input.country ?? null,
        excluded_ids: [...excluded],
        locale: input.locale,
        meal: input.meal,
        limit: limits.candidateLimit,
      }),
    );

    if (candidates.length === 0) {
      return RecommendationOutcome.Empty({
        reasons: ["No published dishes match the current filters."],
      });
    }

    const deterministicTop = rankDeterministic(candidates, input, limits.outputLimit);
    const deterministicIds = deterministicTop.map((candidate) => candidate.id);

    yield* Effect.logInfo("Recommendation candidates resolved").pipe(
      Effect.annotateLogs({
        backend: muse === null ? "deterministic" : "muse",
        candidateCount: candidates.length,
        returnedCount: deterministicTop.length,
      }),
    );

    if (muse === null) {
      const dishes = rotateForSurprise(
        deterministicTop.map((candidate) => toSummary(candidate)),
        input.surpriseSeed,
      );

      const surpriseWarnings =
        input.surpriseSeed === 0 ? [...warnings] : [...warnings, SURPRISE_NOTE];

      return RecommendationOutcome.ReadyDeterministic({
        dishes,
        warnings: [...surpriseWarnings, AI_NOT_CONFIGURED_NOTE],
      });
    }

    const ranked = yield* rankWithMuse(
      candidates,
      input,
      muse,
      deterministicIds,
      limits.outputLimit,
    );

    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
    const hydrated: Array<DishSummary> = [];

    const rankedIds = MuseRankResult.$match(ranked, {
      Ranked: ({ ids }) => ids,
      Degraded: ({ ids }) => ids,
    });

    for (const id of rankedIds) {
      const row = byId.get(id);

      if (row !== undefined) {
        hydrated.push(toSummary(row));
      }
    }

    const dishes = rotateForSurprise(hydrated, input.surpriseSeed);

    const surpriseWarnings =
      input.surpriseSeed === 0 ? [...warnings] : [...warnings, SURPRISE_NOTE];

    return MuseRankResult.$match(ranked, {
      Ranked: () => RecommendationOutcome.ReadyMuse({ dishes, warnings: surpriseWarnings }),
      Degraded: ({ warning }) =>
        RecommendationOutcome.ReadyDeterministic({
          dishes,
          warnings: [...surpriseWarnings, warning],
        }),
    });
  });

export const RecommendationServiceLive = Layer.effect(
  RecommendationService,
  Effect.gen(function* () {
    const ingredients = yield* IngredientRepository;

    const resolveExclusionId = (
      term: string,
      locale: string,
    ): Effect.Effect<bigint | null, DatabaseError, Database> =>
      Effect.gen(function* () {
        const key = normalizeSearchKey(term);

        if (key.length === 0) {
          return null;
        }

        const primary = yield* ingredients.resolveByKey(key, locale, 1);
        const direct = primary[0]?.ingredientId;

        if (direct !== undefined) {
          return direct;
        }

        if (locale === "en") {
          return null;
        }

        const fallback = yield* ingredients.resolveByKey(key, "en", 1);

        return fallback[0]?.ingredientId ?? null;
      });

    const recommend = (
      input: RecommendDishesInput,
    ): Effect.Effect<
      RecommendationOutcome,
      RecommendationError,
      Database | IngredientRepository | MetaClient
    > =>
      Effect.gen(function* () {
        if (!isLanguageTag(input.locale)) {
          return yield* new InvalidLocale({ locale: input.locale });
        }

        if (input.allergies.length > 0) {
          return RecommendationOutcome.Uncertain({
            reasons: [
              ...input.allergies.map(
                (term) =>
                  `Cannot verify dish safety for allergy "${term}"; refusing to rank without complete exclusion data.`,
              ),
              INCOMPLETE_DATA_EXPLANATION,
            ],
          });
        }

        const warnings: Array<string> = [];
        const excluded = new Set<bigint>();

        for (const term of input.avoid) {
          const resolved = yield* resolveExclusionId(term, input.locale);

          if (resolved === null) {
            warnings.push(`Ignored unknown dislike "${term}".`);
          } else {
            excluded.add(resolved);
          }
        }

        const ranking = resolveRankingConfig(serverEnv());

        return yield* RankingConfig.$match(ranking, {
          Misconfigured: ({ reason }) =>
            Effect.logError("Recommendation ranking misconfigured").pipe(
              Effect.annotateLogs({ backend: "muse", reason }),
              Effect.andThen(Effect.fail(new RecommendationMisconfigured({ reason }))),
            ),
          Deterministic: (config) => serveRecommendations(input, warnings, excluded, config, null),
          Muse: (config) => serveRecommendations(input, warnings, excluded, config, config),
        });
      });

    return RecommendationService.of({ recommend });
  }),
);
