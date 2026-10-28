/**
 * Finite vocabularies for the public recommendation chooser.
 *
 * These are closed product vocabularies (not open strings): the transport
 * validates them with Zod enums derived from the same tuples, and the
 * application operation consumes the union types. Open-ended inputs
 * (cuisine slug, ISO country, locale tag, ingredient names) stay strings.
 */
export const MEAL_OCCASIONS = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
  "anything",
] as const;

export type MealOccasion = (typeof MEAL_OCCASIONS)[number];

export const RECOMMENDATION_MOODS = [
  "comforting",
  "light",
  "hearty",
  "spicy",
  "adventurous",
  "surprise",
  "any",
] as const;

export type RecommendationMood = (typeof RECOMMENDATION_MOODS)[number];
