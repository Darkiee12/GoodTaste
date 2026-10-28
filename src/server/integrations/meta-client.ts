import { Context, Data, Effect, Layer, Option, Schema } from "effect";

import type {
  MealOccasion,
  RecommendationMood,
} from "@/modules/food-discovery/server/domain/recommendation";
import { type ModelConfig, modelConfig } from "@/server/env";

/**
 * Typed failures for the Muse ranking integration. Transport problems
 * (network, timeouts, non-2xx status) surface as MetaRequestError; a
 * well-formed HTTP response whose body is not the expected ranking envelope
 * surfaces as MetaInvalidOutput. The client never retries 401/400 or
 * schema-invalid responses: the caller falls back to deterministic order.
 */
export class MetaRequestError extends Data.TaggedError("MetaRequestError")<{
  readonly reason: string;
  readonly status?: number | undefined;
}> {}

export class MetaInvalidOutput extends Data.TaggedError("MetaInvalidOutput")<{
  readonly reason: string;
}> {}

export type MetaError = MetaRequestError | MetaInvalidOutput;

export interface MetaRankCandidate {
  readonly id: string;
  readonly name: string;
  readonly cuisines: ReadonlyArray<string>;
  readonly categories: ReadonlyArray<string>;
  readonly description: string | null;
}

export interface MetaRankContext {
  readonly occasion: MealOccasion;
  readonly mood: RecommendationMood;
  readonly cuisineOrRegion: string | null;
}

export class MetaClient extends Context.Service<
  MetaClient,
  {
    readonly rank: (
      candidates: ReadonlyArray<MetaRankCandidate>,
      context: MetaRankContext,
    ) => Effect.Effect<ReadonlyArray<string>, MetaError>;
  }
>()("feastjourney/integrations/MetaClient") {}

const ChatEnvelope = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.String }),
    }),
  ),
});

const RankingPayload = Schema.Struct({
  ranked_candidate_ids: Schema.Array(Schema.String),
});

export type RankingPayload = typeof RankingPayload.Type;

/** Decode untrusted provider JSON into the canonical ranking contract. */
export const decodeRankingPayload = Schema.decodeUnknownOption(RankingPayload);

/**
 * Provider-facing JSON Schema for the ranking response. Kept as the
 * smallest explicit schema the endpoint accepts; parity with
 * RankingPayload is enforced by tests/unit/meta-schema-parity.test.ts.
 * Never inject candidate IDs as enum values (schema size limits).
 */
export const RANKING_SCHEMA = {
  type: "object",
  properties: {
    ranked_candidate_ids: { type: "array", items: { type: "string" } },
  },
  required: ["ranked_candidate_ids"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You rank restaurant dishes for a diner.",
  "Rank ONLY the dish IDs supplied in the user message.",
  "Never invent, add, or rename dishes.",
  "Never make safety, allergy, or medical claims.",
  "Respond with JSON only, matching the requested schema.",
].join(" ");

const buildUserPrompt = (
  candidates: ReadonlyArray<MetaRankCandidate>,
  context: MetaRankContext,
): string => {
  const lines = candidates.map(
    (candidate) =>
      `- id: ${candidate.id} | name: ${candidate.name} | cuisines: ${candidate.cuisines.join(",")} | categories: ${candidate.categories.join(",")} | description: ${candidate.description ?? ""}`,
  );

  return [
    `Occasion: ${context.occasion}; mood: ${context.mood}; cuisine or region: ${context.cuisineOrRegion ?? "any"}.`,
    "Rank the most suitable dish IDs first and return at most the requested count.",
    ...lines,
  ].join("\n");
};

export const MetaClientLive = Layer.succeed(MetaClient, {
  rank: (candidates, context) =>
    Effect.gen(function* () {
      const config: ModelConfig = yield* Effect.try({
        try: () => modelConfig(),
        catch: () => new MetaRequestError({ reason: "AI configuration is unavailable" }),
      });

      const apiKey = config.apiKey;

      if (apiKey === undefined || apiKey.length === 0) {
        return yield* new MetaRequestError({ reason: "MODEL_API_KEY is not configured" });
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: config.modelId,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: buildUserPrompt(candidates, context) },
              ],
              response_format: {
                type: "json_schema",
                json_schema: { name: "dish_ranking", schema: RANKING_SCHEMA },
              },
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
          }),
        catch: () => new MetaRequestError({ reason: "Meta ranking request failed" }),
      });

      if (!response.ok) {
        return yield* new MetaRequestError({
          reason: `Meta ranking request failed with status ${response.status}`,
          status: response.status,
        });
      }

      const body: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new MetaInvalidOutput({ reason: "Meta ranking response was not JSON" }),
      });

      const envelope = Schema.decodeUnknownOption(ChatEnvelope)(body);

      if (Option.isNone(envelope)) {
        return yield* new MetaInvalidOutput({ reason: "Meta ranking envelope was unexpected" });
      }

      const content = envelope.value.choices[0]?.message.content;

      if (content === undefined) {
        return yield* new MetaInvalidOutput({ reason: "Meta ranking contained no choices" });
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(content);
      } catch {
        return yield* new MetaInvalidOutput({ reason: "Meta ranking content was not JSON" });
      }

      const payload = Schema.decodeUnknownOption(RankingPayload)(parsed);

      if (Option.isNone(payload)) {
        return yield* new MetaInvalidOutput({ reason: "Meta ranking shape was unexpected" });
      }

      return payload.value.ranked_candidate_ids;
    }),
});
