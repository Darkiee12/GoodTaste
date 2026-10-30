/**
 * Client-safe shapes for the bulk editorial review panel. These mirror the
 * `BulkPublishService` projections without importing server code, so the
 * panel stays browser-safe and the coordinator can wire any transport that
 * returns these shapes (proposed `adminBulk*` server functions).
 */

export interface BulkReviewCandidate {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly displayName: string | null;
  readonly importJobId: string | null;
  readonly importSourceName: string | null;
  readonly importLicense: string | null;
  readonly importLicenseAck: boolean;
  readonly importReviewAck: boolean;
  readonly hasEnglishName: boolean;
  readonly hasDescription: boolean;
  readonly ingredientCount: number;
  readonly categoryCount: number;
  readonly placeCount: number;
  readonly sourceCount: number;
  readonly noteCount: number;
  readonly openQuestionCount: number;
  readonly licenseNeedsReview: boolean;
}

export interface BulkPublishedRecord {
  readonly id: string;
  readonly slug: string;
}

export interface BulkSkippedRecord {
  readonly id: string;
  readonly reason: string;
}

export interface BulkFailedRecord {
  readonly id: string;
  readonly reasons: ReadonlyArray<string>;
}

export interface BulkPublishReport {
  readonly published: ReadonlyArray<BulkPublishedRecord>;
  readonly skipped: ReadonlyArray<BulkSkippedRecord>;
  readonly failed: ReadonlyArray<BulkFailedRecord>;
}

export interface BulkPublishAcks {
  readonly editorialAck: boolean;
  readonly licenseAck: boolean;
}

export interface BulkCandidatesPage {
  readonly items: ReadonlyArray<BulkReviewCandidate>;
  readonly nextCursor: string | null;
}

/**
 * Every user-facing string the bulk panel renders. Passed in as props so
 * copy lives in the locale catalog (`src/shared/i18n.ts`, owned by another
 * agent) instead of inside the component. See the final Agent C report for
 * the proposed en/vi entries.
 */
export interface BulkReviewLabels {
  readonly heading: string;
  readonly description: string;
  readonly jobFilterLabel: string;
  readonly jobFilterPlaceholder: string;
  readonly applyFilter: string;
  readonly clearFilter: string;
  readonly selectAll: string;
  readonly selectedCount: (count: number) => string;
  readonly dishColumn: string;
  readonly flagsColumn: string;
  readonly jobColumn: string;
  readonly publishSelected: string;
  readonly publishing: string;
  readonly loadMore: string;
  readonly editorialAck: string;
  readonly licenseAck: string;
  readonly confirmTitle: (count: number) => string;
  readonly confirmDescription: (count: number) => string;
  readonly confirm: string;
  readonly cancel: string;
  readonly close: string;
  readonly publishedHeading: (count: number) => string;
  readonly skippedHeading: (count: number) => string;
  readonly failedHeading: (count: number) => string;
  readonly retryFailed: string;
  readonly flagNoEnglishName: string;
  readonly flagNoDescription: string;
  readonly flagNoIngredients: string;
  readonly flagNoCategories: string;
  readonly flagNoPlaces: string;
  readonly flagNoSources: string;
  readonly flagOpenQuestions: (count: number) => string;
  readonly flagLicenseReview: string;
  readonly flagReady: string;
  readonly empty: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly publishFailed: string;
}
