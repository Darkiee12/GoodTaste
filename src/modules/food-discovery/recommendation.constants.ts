/**
 * Browser-safe finite vocabularies for the public recommendation chooser.
 *
 * Single source of truth shared by the Zod transport schemas, the domain
 * input contracts, the Meta ranking context, and the UI option lists.
 * Pure constants only: this module must stay free of server, Effect, and
 * Zod imports so browser bundles never pull server code.
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
