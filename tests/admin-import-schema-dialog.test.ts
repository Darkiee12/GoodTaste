import { describe, expect, test } from "bun:test";

import { Option, Schema } from "effect";

import {
  CSV_COLUMNS,
  RECORD_FIELDS,
  SAMPLE_CSV,
  countRecords,
} from "@/components/admin/import-wizard/helpers";
import {
  FEASTJOURNEY_JSON_TEMPLATE,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_RECORDS,
  csvToRecords,
  jsonToRecords,
} from "@/modules/food-discovery/admin.schema";
import {
  IngredientRole,
  NameKind,
  PlaceAssociation,
} from "@/modules/food-discovery/server/domain/ids";
import { AuthoringDish } from "@/modules/food-discovery/server/domain/schemas";

/**
 * Schema-dialog drift pins. RECORD_FIELDS and CSV_COLUMNS are
 * hand-maintained reference tables (never presented as generated), so this
 * file pins them against the canonical contracts: the `AuthoringDish`
 * struct, the real `csvToRecords`/`jsonToRecords` parsers, and the
 * canonical id enums. A stale row fails here, not in review.
 */

const recordText = (row: (typeof RECORD_FIELDS)[number]): string =>
  [row.type, ...(row.members ?? []).map((member) => `${member.name} ${member.detail}`)].join(" ");

describe("schema dialog record fields", () => {
  test("field set matches the canonical AuthoringDish struct exactly", () => {
    const canonical = Object.keys(AuthoringDish.fields).toSorted();
    const documented = RECORD_FIELDS.map((row) => row.field).toSorted();

    expect(documented).toEqual(canonical);
  });

  test("only names is required: a names-only record validates, an empty one does not", () => {
    const minimal = {
      names: [{ language_tag: "en", name: "Beef pho", name_kind: "localized" }],
    };

    expect(Option.isSome(Schema.decodeUnknownOption(AuthoringDish)(minimal))).toBe(true);
    expect(Option.isSome(Schema.decodeUnknownOption(AuthoringDish)({}))).toBe(false);
    expect(RECORD_FIELDS.find((row) => row.field === "names")?.required).toBe(true);
  });

  test("canonical vocabularies appear in the table and validate", () => {
    const documented = RECORD_FIELDS.map(recordText).join(" ");

    for (const vocabulary of [
      NameKind.literals,
      IngredientRole.literals,
      PlaceAssociation.literals,
    ]) {
      for (const value of vocabulary) {
        expect(documented).toContain(value);
      }
    }

    for (const value of NameKind.literals) {
      expect(Option.isSome(Schema.decodeUnknownOption(NameKind)(value))).toBe(true);
    }

    for (const value of IngredientRole.literals) {
      expect(Option.isSome(Schema.decodeUnknownOption(IngredientRole)(value))).toBe(true);
    }

    for (const value of PlaceAssociation.literals) {
      expect(Option.isSome(Schema.decodeUnknownOption(PlaceAssociation)(value))).toBe(true);
    }
  });
});

describe("schema dialog examples", () => {
  test("canonical template parses and validates as AuthoringDish records", () => {
    const records = jsonToRecords(FEASTJOURNEY_JSON_TEMPLATE);

    expect(records.length).toBeGreaterThan(0);

    for (const record of records) {
      expect(Option.isSome(Schema.decodeUnknownOption(AuthoringDish)(record))).toBe(true);
    }
  });

  test("sample CSV parses and validates as AuthoringDish records", () => {
    const records = csvToRecords(SAMPLE_CSV);

    expect(records.length).toBe(1);

    for (const record of records) {
      expect(Option.isSome(Schema.decodeUnknownOption(AuthoringDish)(record))).toBe(true);
    }
  });

  test("template and sample fit the enforced import limits", () => {
    expect(new TextEncoder().encode(FEASTJOURNEY_JSON_TEMPLATE).length).toBeLessThan(
      MAX_IMPORT_FILE_BYTES,
    );
    expect(new TextEncoder().encode(SAMPLE_CSV).length).toBeLessThan(MAX_IMPORT_FILE_BYTES);
    expect(countRecords("json", FEASTJOURNEY_JSON_TEMPLATE)).toBeLessThanOrEqual(
      MAX_IMPORT_RECORDS,
    );
    expect(countRecords("csv", SAMPLE_CSV)).toBeLessThanOrEqual(MAX_IMPORT_RECORDS);
  });
});

describe("schema dialog CSV table", () => {
  const validCell: ReadonlyMap<string, string> = new Map([
    ["slug", "pho-bo"],
    ["status", "review"],
    ["parent_slug", "pho"],
    ["name", "Beef pho"],
    ["language_tag", "en"],
    ["name_kind", "native"],
    ["description", "Noodle soup."],
    ["ingredients", "rice noodles;beef"],
    ["places", "VN:origin;FR:popular"],
    ["cuisines", "vietnamese"],
    ["categories", "noodles"],
    ["editorial_note", "Verify with a cook."],
  ]);

  test("sample header matches the documented columns in order", () => {
    const header = (SAMPLE_CSV.split("\n")[0] ?? "").split(",");

    expect(header).toEqual(CSV_COLUMNS.map((column) => column.name));
  });

  test("every documented column parses through the real reader", () => {
    for (const column of CSV_COLUMNS) {
      const header = column.name === "name" ? "name" : `name,${column.name}`;
      const value = validCell.get(column.name) ?? "x";

      const text =
        column.name === "name" ? `${header}\n${value}\n` : `${header}\nBeef pho,${value}\n`;

      expect(countRecords("csv", text)).toBe(1);
    }
  });

  test("the strict parser rejects what the table does not document", () => {
    expect(() => csvToRecords("name,bogus_xyz\nBeef pho,x\n")).toThrow();
    expect(() => csvToRecords("name,name\nBeef pho,x\n")).toThrow();
    expect(() => csvToRecords("slug\npho-bo\n")).toThrow();
    expect(() => csvToRecords("name,slug\nBeef pho\n")).toThrow();
  });
});
