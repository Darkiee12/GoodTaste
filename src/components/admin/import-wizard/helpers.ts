import {
  FEASTJOURNEY_JSON_TEMPLATE,
  csvToRecords,
  jsonToRecords,
} from "@/modules/food-discovery/admin.schema";

export const SAMPLE_CSV = `slug,status,parent_slug,name,language_tag,name_kind,description,ingredients,places,cuisines,categories,editorial_note
pho-bo-vietnam,review,,Beef pho,en,localized,Vietnamese beef noodle soup with flat rice noodles.,rice noodles;beef,VN:origin;FR:popular,vietnamese,noodles,Verify ingredients with a local cook.
`;

/**
 * Reference tables for the Upload-stage schema viewer. Kept in this
 * pure module (no React) so unit tests can pin them against the real
 * contracts: CSV_COLUMNS mirrors the documented `csvToRecords` contract in
 * `admin.schema.ts`, and RECORD_FIELDS mirrors `AuthoringDish` in
 * `server/domain/schemas.ts` field by field.
 */
export const CSV_COLUMNS: ReadonlyArray<{ readonly name: string; readonly detail: string }> = [
  { name: "slug", detail: "optional slug; auto-derived from name when absent" },
  { name: "status", detail: "optional; draft (default) or review" },
  { name: "parent_slug", detail: "optional slug of the parent dish" },
  { name: "name", detail: "required; one dish name per row" },
  { name: "language_tag", detail: "optional; BCP 47 (default en)" },
  { name: "name_kind", detail: "optional; native, localized (default), alias, transliteration" },
  { name: "description", detail: "optional; 1–20000 chars" },
  { name: "ingredients", detail: "optional; names separated by ;" },
  {
    name: "places",
    detail:
      "optional; ISO entries separated by ; — ISO, ISO:origin, ISO:associated, ISO:popular (bare ISO means associated)",
  },
  { name: "cuisines", detail: "optional; cuisine slugs separated by ;" },
  { name: "categories", detail: "optional; category slugs separated by ;" },
  { name: "editorial_note", detail: "optional; 1–2000 chars" },
];

export interface ReferenceFieldRow {
  readonly field: string;
  readonly required: boolean;
  readonly type: string;
}

export const RECORD_FIELDS: ReadonlyArray<ReferenceFieldRow> = [
  { field: "slug", required: false, type: "slug: lowercase letters, digits, hyphens" },
  { field: "status", required: false, type: '"draft" or "review"' },
  { field: "parent_slug", required: false, type: "slug of the parent dish" },
  {
    field: "names",
    required: true,
    type: "non-empty array of { language_tag (BCP 47), name (1–300 chars), name_kind (native, localized, alias, transliteration) }",
  },
  {
    field: "descriptions",
    required: false,
    type: "array of { language_tag, description (1–20000 chars), summary (null or 1–1000 chars) }",
  },
  {
    field: "ingredients",
    required: false,
    type: "array of { name (1–300 chars), role (core, common, optional, garnish), language_tag? }",
  },
  {
    field: "places",
    required: false,
    type: "array of { iso (AA or AA-XXX uppercase code)?, place_id?, association (origin, associated, popular), note? }",
  },
  { field: "cuisines", required: false, type: "array of cuisine slugs" },
  { field: "categories", required: false, type: "array of category slugs" },
  { field: "editorial_note", required: false, type: "1–2000 chars" },
];

export const stripBom = (text: string): string => {
  if (text.startsWith("﻿")) {
    return text.slice(1);
  }

  return text;
};

export const sniffFileType = (name: string, text: string): "json" | "csv" | null => {
  const lower = name.toLowerCase();

  if (lower.endsWith(".json")) {
    return "json";
  }

  if (lower.endsWith(".csv")) {
    return "csv";
  }

  const trimmed = text.trimStart();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(text);
    } catch {
      return null;
    }

    return "json";
  }

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";

  if (firstLine.toLowerCase().includes("name")) {
    return "csv";
  }

  return null;
};

export const countRecords = (fileType: "json" | "csv", text: string): number | null => {
  try {
    const records = fileType === "json" ? jsonToRecords(text) : csvToRecords(text);

    return records.length;
  } catch {
    return null;
  }
};

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const downloadText = (filename: string, text: string, mime: string): void => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadTemplate = (): void => {
  downloadText("feastjourney-template.json", FEASTJOURNEY_JSON_TEMPLATE, "application/json");
};

export const downloadSample = (): void => {
  downloadText("feastjourney-sample.csv", SAMPLE_CSV, "text/csv");
};
