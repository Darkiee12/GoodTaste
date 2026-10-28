import { Context, Data, Effect, Layer } from "effect";

import type { DishSummary } from "@/modules/food-discovery/server/domain/dish";
import { InvalidLocale } from "@/modules/food-discovery/server/domain/errors";
import { isLanguageTag } from "@/modules/food-discovery/server/domain/ids";
import type {
  MealOccasion,
  RecommendationMood,
} from "@/modules/food-discovery/server/domain/recommendation";
import { normalizeSearchKey } from "@/modules/food-discovery/server/domain/search";
import { IngredientRepository } from "@/modules/food-discovery/server/repository/ingredient-repository";
import dishRecommendationCandidates from "@/modules/food-discovery/server/repository/sql/dish-recommendation-candidates.sql";
import type { Database } from "@/server/database/client";
import type { DatabaseError } from "@/server/database/query";
import { runQuery } from "@/server/database/query";
import { modelConfig } from "@/server/env";
import {
  MetaClient,
  type MetaRankCandidate,
  MetaInvalidOutput,
} from "@/server/integrations/meta-client";

export type RecommendationCandidateRow = (typeof dishRecommendationCandidates)["~reylo"]["element"];

export type RecommendationOutcome = Data.TaggedEnum<{
  Ready: {
    readonly dishes: ReadonlyArray<DishSummary>;
    readonly mode: "ai" | "deterministic";
    readonly warnings: ReadonlyArray<string>;
  };
  Uncertain: { readonly reasons: ReadonlyArray<string> };
  Empty: { readonly reasons: ReadonlyArray<string> };
}>;

export const RecommendationOutcome = Data.taggedEnum<RecommendationOutcome>();

export interface RecommendDishesInput {
  readonly meal: MealOccasion;
  readonly avoid: ReadonlyArray<string>;
  readonly allergies: ReadonlyArray<string>;
  readonly cuisine?: string | undefined;
  readonly country?: string | undefined;
  readonly mood: RecommendationMood;
  readonly locale: string;
}

export type RecommendationError = InvalidLocale | DatabaseError;

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

const ALLERGY_DATA_WARNING = "Ingredient data may be incomplete; this is not an allergy guarantee.";

const AI_NOT_CONFIGURED_NOTE = "Deterministic mode: AI ranking is not configured.";

const AI_FALLBACK_WARNING = "AI ranking was unavailable; used deterministic order instead.";

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
        return yield* new MetaInvalidOutput({ reason: "Meta ranking contained duplicate ids" });
      }

      seen.add(id);
    }

    return ids;
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

        const warnings: Array<string> = [];
        const excluded = new Set<bigint>();
        const unresolvableAllergies: Array<string> = [];

        for (const term of input.avoid) {
          const resolved = yield* resolveExclusionId(term, input.locale);

          if (resolved === null) {
            warnings.push(`Ignored unknown dislike "${term}".`);
          } else {
            excluded.add(resolved);
          }
        }

        for (const term of input.allergies) {
          const resolved = yield* resolveExclusionId(term, input.locale);

          if (resolved === null) {
            unresolvableAllergies.push(term);
          } else {
            excluded.add(resolved);
          }
        }

        if (unresolvableAllergies.length > 0) {
          return RecommendationOutcome.Uncertain({
            reasons: unresolvableAllergies.map(
              (term) =>
                `Could not resolve allergy "${term}"; refusing to rank without complete exclusion data.`,
            ),
          });
        }

        if (input.allergies.length > 0) {
          warnings.push(ALLERGY_DATA_WARNING);
        }

        const config = modelConfig();
        const candidateLimit = Math.min(Math.max(Math.floor(config.candidateLimit), 1), 100);
        const outputLimit = Math.min(Math.max(Math.floor(config.outputLimit), 1), 10);

        const candidates = yield* runQuery("dish/recommendation-candidates", (sql) =>
          dishRecommendationCandidates.run(sql, {
            cuisine: input.cuisine ?? null,
            country: input.country ?? null,
            excluded_ids: [...excluded],
            locale: input.locale,
            limit: candidateLimit,
          }),
        );

        if (candidates.length === 0) {
          return RecommendationOutcome.Empty({
            reasons: ["No published dishes match the current filters."],
          });
        }

        const mealSlug = input.meal === "anything" ? null : input.meal;

        const scored = candidates.map((candidate) => {
          let score = 1;

          if (
            input.cuisine !== undefined &&
            nonNullStrings(candidate.cuisines).includes(input.cuisine)
          ) {
            score += 2;
          }

          if (mealSlug !== null && nonNullStrings(candidate.categories).includes(mealSlug)) {
            score += 1;
          }

          return { candidate, score };
        });

        scored.sort(
          (left, right) =>
            right.score - left.score || compareIds(left.candidate.id, right.candidate.id),
        );

        const deterministicTop = scored.slice(0, outputLimit);
        const deterministicIds = deterministicTop.map((entry) => entry.candidate.id);

        if (config.apiKey === undefined || config.apiKey.length === 0) {
          return RecommendationOutcome.Ready({
            dishes: deterministicTop.map((entry) => toSummary(entry.candidate)),
            mode: "deterministic",
            warnings: [...warnings, AI_NOT_CONFIGURED_NOTE],
          });
        }

        const rankInput: Array<MetaRankCandidate> = candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          cuisines: nonNullStrings(candidate.cuisines),
          categories: nonNullStrings(candidate.categories),
          description: candidate.description,
        }));

        const ranked = yield* Effect.flatMap(
          Effect.flatMap(MetaClient, (client) =>
            client.rank(rankInput, {
              occasion: input.meal,
              mood: input.mood,
              cuisineOrRegion: input.cuisine ?? input.country ?? null,
            }),
          ),
          (ids) => validateRankedIds(ids, candidates, outputLimit),
        ).pipe(
          Effect.map((ids) => ({ ids, ai: true as const })),
          Effect.catch(() => Effect.succeed({ ids: deterministicIds, ai: false as const })),
        );

        const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
        const dishes: Array<DishSummary> = [];

        for (const id of ranked.ids) {
          const row = byId.get(id);

          if (row !== undefined) {
            dishes.push(toSummary(row));
          }
        }

        if (ranked.ai) {
          return RecommendationOutcome.Ready({ dishes, mode: "ai", warnings });
        }

        return RecommendationOutcome.Ready({
          dishes,
          mode: "deterministic",
          warnings: [...warnings, AI_FALLBACK_WARNING],
        });
      });

    return RecommendationService.of({ recommend });
  }),
);
