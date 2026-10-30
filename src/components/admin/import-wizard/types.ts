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
