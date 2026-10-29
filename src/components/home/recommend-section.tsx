import { RecommendSection as RecommendQuiz } from "@/components/home/recommend/quiz-flow";

/**
 * Homepage recommendation section. The 3-step quiz lives in
 * `recommend/` (orchestration, stage presentation, summary, result card,
 * status); this entry keeps the historical import path stable for route
 * code and the client-parsing tests, which import the pure quiz model
 * helpers from here.
 */
export function RecommendSection() {
  return <RecommendQuiz />;
}

export {
  buildRecommendPayload,
  buildSurprisePayload,
  clearJourneySnapshot,
  draftFromSavedPrefs,
  EMPTY_DRAFT,
  formatTemplate,
  MAX_REC_TERM_LENGTH,
  mealSchema,
  moodSchema,
  parseCommaList,
  persistPrefs,
  readInitialDraft,
  readJourneySnapshot,
  readSavedPrefs,
  recCountrySchema,
  removeSavedPrefs,
  sanitizeCountryCode,
  serializePrefs,
  termLengthError,
  tooLongTerms,
  validateRegion,
  writeJourneySnapshot,
  type JourneySnapshot,
  type QuizDraft,
  type RecommendAnswers,
  type RecommendPayload,
  type RecRegionMode,
  type SavedRecommendPrefs,
  type SurpriseInputs,
} from "@/components/home/recommend/quiz-model";
