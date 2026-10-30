import { z } from "zod";

import type {
  adminImportApplyFn,
  adminImportValidateFn,
} from "@/modules/food-discovery/admin.functions";

export const STAGES = [
  "upload",
  "source",
  "validate",
  "issues",
  "confirm",
  "apply",
  "done",
] as const;

export type Stage = (typeof STAGES)[number];

export interface DatasetFile {
  readonly contentText: string;
  readonly fileType: "json" | "csv";
  readonly name: string;
  readonly recordCount: number | null;
  readonly sha256: string;
  readonly size: number;
}

export type ValidateOutcome = Awaited<ReturnType<typeof adminImportValidateFn>>;

export type ApplyOutcome = Awaited<ReturnType<typeof adminImportApplyFn>>;

export type ValidationReport = Extract<ValidateOutcome, { ok: true }>["report"];

export type ValidationItem = ValidationReport["items"][number];

// Defensive readers for Agent 1's incoming cursor-driven batched protocol.
// The current synchronous API returns none of these fields, so every read
// falls back to single-shot rendering. When the server starts returning
// progress/pagination fields, the wizard picks them up with no UI rewrite:
// re-running the same validate/apply call with the reported cursor resumes
// the job. No invented contract here — only optional-field reads.

// Optional batched-protocol extensions are parsed here, at the UI boundary:
// every field is optional, so the current synchronous payloads validate to
// empty extensions and the wizard falls back to single-shot rendering.
const optionalCount = z.number().int().min(0).nullish();
const optionalCursor = z.string().min(1).nullish();

const reportExtensionsSchema = z
  .object({
    processedRecords: optionalCount,
    cursor: optionalCursor,
    nextCursor: optionalCursor,
    hasMore: z.boolean().optional(),
  })
  .passthrough();

const applyExtensionsSchema = z
  .object({
    applied: optionalCount,
    skippedDuplicate: optionalCount,
    failed: optionalCount,
    pendingRecords: optionalCount,
    cursor: optionalCursor,
    nextCursor: optionalCursor,
    hasMore: z.boolean().optional(),
  })
  .passthrough();

const itemExtensionsSchema = z
  .object({
    rowNumber: optionalCount,
    rowIndex: optionalCount,
  })
  .passthrough();

const parseReportExtensions = (
  report: ValidationReport,
): z.infer<typeof reportExtensionsSchema> => {
  const parsed = reportExtensionsSchema.safeParse(report);

  if (parsed.success) {
    return parsed.data;
  }

  return {};
};

const parseApplyExtensions = (result: ApplyOutcome): z.infer<typeof applyExtensionsSchema> => {
  const parsed = applyExtensionsSchema.safeParse(result);

  if (parsed.success) {
    return parsed.data;
  }

  return {};
};

export interface ValidationProgress {
  readonly processedRecords: number;
  readonly totalRecords: number;
  readonly hasMore: boolean;
  readonly cursor: string | null;
}

export const validationProgress = (report: ValidationReport): ValidationProgress => {
  const ext = parseReportExtensions(report);
  const totalRecords = report.totalRecords;
  const processed = ext.processedRecords ?? totalRecords;

  return {
    processedRecords: Math.min(processed, totalRecords),
    totalRecords,
    hasMore: ext.hasMore === true || (ext.nextCursor ?? null) !== null,
    cursor: ext.cursor ?? ext.nextCursor ?? null,
  };
};

export interface ApplyProgress {
  readonly applied: number;
  readonly skippedDuplicate: number;
  readonly failed: number;
  readonly pendingRecords: number | null;
  readonly hasMore: boolean;
  readonly cursor: string | null;
}

export const applyProgress = (result: ApplyOutcome): ApplyProgress => {
  const ext = parseApplyExtensions(result);

  return {
    applied: ext.applied ?? 0,
    skippedDuplicate: ext.skippedDuplicate ?? 0,
    failed: ext.failed ?? 0,
    pendingRecords: ext.pendingRecords ?? null,
    hasMore: ext.hasMore === true || (ext.nextCursor ?? null) !== null,
    cursor: ext.cursor ?? ext.nextCursor ?? null,
  };
};

export interface NumberedIssue {
  readonly item: ValidationItem;
  /** Original 1-based dataset row number (server-provided, else report order). */
  readonly rowNumber: number;
}

export const numberIssues = (items: ReadonlyArray<ValidationItem>): ReadonlyArray<NumberedIssue> =>
  items.map((item, index) => {
    const parsed = itemExtensionsSchema.safeParse(item);
    const ext = parsed.success ? parsed.data : {};
    const fromIndex = ext.rowIndex === undefined || ext.rowIndex === null ? null : ext.rowIndex + 1;
    const provided = ext.rowNumber ?? fromIndex;

    return {
      item,
      rowNumber: provided !== null && provided > 0 ? provided : index + 1,
    };
  });

export type IssueFilter = "all" | "invalid" | "duplicates";
