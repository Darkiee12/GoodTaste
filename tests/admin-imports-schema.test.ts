import { describe, expect, test } from "bun:test";

import {
  CSV_COLUMNS,
  RECORD_FIELDS,
  SAMPLE_CSV,
  countRecords,
  sniffFileType,
  stripBom,
} from "@/components/admin/import-wizard/helpers";
import {
  FEASTJOURNEY_JSON_TEMPLATE,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  SOURCE_REGISTRY,
  importJobStatusSchema,
  importLicenseSchema,
  jsonToRecords,
  needsLicenseReview,
} from "@/modules/food-discovery/admin.schema";
import { formatFileSize } from "@/shared/format-file-size";

/**
 * Import-wizard client contracts. Pure unit tests — no DB, no server.
 * Pins the Upload-stage helpers and the schema-viewer tables against the
 * real transport contracts so drift fails loudly here, not in review.
 */

describe("upload helpers", () => {
  test("stripBom removes a leading byte-order mark", () => {
    expect(stripBom("﻿hello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
  });

  test("sniffFileType trusts extensions, then content", () => {
    expect(sniffFileType("data.json", "")).toBe("json");
    expect(sniffFileType("data.csv", "")).toBe("csv");
    expect(sniffFileType("data.txt", '{"records": []}')).toBe("json");
    expect(sniffFileType("data.txt", "name\nBeef pho")).toBe("csv");
    expect(sniffFileType("data.txt", "not a dataset")).toBe(null);
  });

  test("countRecords parses JSON envelopes and the sample CSV", () => {
    expect(countRecords("json", FEASTJOURNEY_JSON_TEMPLATE)).toBe(1);
    expect(countRecords("json", '[{"names": []}]')).toBe(1);
    expect(countRecords("csv", SAMPLE_CSV)).toBe(1);
    expect(countRecords("json", "{oops")).toBe(null);
  });
});

describe("transport contracts", () => {
  test("size and record limits match the staged pipeline", () => {
    expect(MAX_IMPORT_FILE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_IMPORT_RECORDS).toBe(100);
  });

  test("job lifecycle includes the crash-resume applying state", () => {
    expect(importJobStatusSchema.options).toEqual([
      "staged",
      "validated",
      "applying",
      "applied",
      "failed",
    ]);
  });

  test("licenses and sources are closed vocabularies", () => {
    expect(importLicenseSchema.options.length).toBeGreaterThan(0);
    expect(SOURCE_REGISTRY.map((entry) => entry.id)).toEqual([
      "manual",
      "partner",
      "community",
      "other",
    ]);
    expect(needsLicenseReview("other", "cc0")).toBe(true);
    expect(needsLicenseReview("community", "cc0")).toBe(true);
    expect(needsLicenseReview("manual", "unknown")).toBe(true);
    expect(needsLicenseReview("partner", "partner-agreement")).toBe(false);
  });

  test("jsonToRecords rejects empty and envelopeless payloads", () => {
    expect(() => jsonToRecords('{"records": []}')).toThrow();
    expect(() => jsonToRecords('{"nope": []}')).toThrow();

    const records = jsonToRecords(FEASTJOURNEY_JSON_TEMPLATE);

    expect(records.length).toBe(1);
  });
});

describe("file-size formatter", () => {
  test("uses binary units matching the enforced byte limits", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(1024)).toBe("1 KiB");
    expect(formatFileSize(512 * 1024)).toBe("512 KiB");
    expect(formatFileSize(16 * 1024 * 1024)).toBe("16 MiB");
    expect(formatFileSize(2_274_836)).toBe("2.2 MiB");
    expect(formatFileSize(19_084_288)).toBe("18.2 MiB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GiB");
  });

  test("never throws on hostile input", () => {
    expect(formatFileSize(-5)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  test("the enforced upload limit renders as an exact binary label", () => {
    expect(formatFileSize(MAX_IMPORT_FILE_BYTES)).toBe("16 MiB");
  });
});

describe("schema-viewer tables", () => {
  test("record fields mirror AuthoringDish: names required, rest optional", () => {
    const byField = new Map(RECORD_FIELDS.map((row) => [row.field, row]));

    expect(byField.get("names")?.required).toBe(true);

    for (const field of [
      "slug",
      "status",
      "parent_slug",
      "descriptions",
      "ingredients",
      "places",
      "cuisines",
      "categories",
      "editorial_note",
    ]) {
      expect(byField.get(field)?.required).toBe(false);
    }
  });

  test("CSV table covers the strict parser shape with name required", () => {
    const byColumn = new Map(CSV_COLUMNS.map((column) => [column.name, column.detail]));

    expect(CSV_COLUMNS.length).toBe(12);
    expect(byColumn.get("name")).toContain("required");

    // Every documented column parses through the real reader.
    expect(countRecords("csv", SAMPLE_CSV)).toBe(1);
  });
});
