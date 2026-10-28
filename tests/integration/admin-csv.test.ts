import { describe, expect, test } from "bun:test";

import { csvToRecords } from "@/modules/food-discovery/admin.schema";

describe("csvToRecords places grammar", () => {
  test("bare ISO codes default to associated, never origin", () => {
    expect(csvToRecords("name,places\nPho,VN\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [{ iso: "VN", association: "associated" }],
      },
    ]);
  });

  test("explicit :origin and :popular suffixes are preserved", () => {
    expect(csvToRecords("name,places\nPho,VN:origin\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [{ iso: "VN", association: "origin" }],
      },
    ]);

    expect(csvToRecords("name,places\nPho,FR:popular\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [{ iso: "FR", association: "popular" }],
      },
    ]);
  });

  test("association suffixes match case-insensitively", () => {
    expect(csvToRecords("name,places\nPho,vn:Origin\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [{ iso: "vn", association: "origin" }],
      },
    ]);
  });

  test("surrounding whitespace around ISO and association is tolerated", () => {
    expect(csvToRecords("name,places\nPho, VN : popular \n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [{ iso: "VN", association: "popular" }],
      },
    ]);
  });

  test("mixed cells yield each entry with its own association", () => {
    expect(csvToRecords("name,places\nPho,VN:origin;FR:popular;DE\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [
          { iso: "VN", association: "origin" },
          { iso: "FR", association: "popular" },
          { iso: "DE", association: "associated" },
        ],
      },
    ]);
  });

  test("empty entries after splitting are ignored", () => {
    expect(csvToRecords("name,places\nPho,VN;; DE\n")).toEqual([
      {
        names: [{ language_tag: "en", name: "Pho", name_kind: "localized" }],
        places: [
          { iso: "VN", association: "associated" },
          { iso: "DE", association: "associated" },
        ],
      },
    ]);
  });

  test("unknown associations throw naming the 1-based data row", () => {
    expect(() => csvToRecords("name,places\nPho,VN:homeland\n")).toThrow(
      'row 2: unsupported place association "homeland"',
    );

    expect(() => csvToRecords("name,places\nPho,VN\nBun,FR:homeland\n")).toThrow(
      'row 3: unsupported place association "homeland"',
    );
  });
});

describe("csvToRecords existing behaviors", () => {
  test("parses the documented CSV shape with quoted fields", () => {
    const records = csvToRecords(
      'slug,status,name,language_tag,ingredients,places\n"my-dish",review,"Good, Tasty Dish",en,"rice; beans",VN\n',
    );

    expect(records.length).toBe(1);

    const serialized = JSON.stringify(records[0]);

    expect(serialized).toContain("Good, Tasty Dish");
    expect(serialized).toContain("beans");
  });

  test("rejects CSV with unknown columns", () => {
    expect(() => csvToRecords("name,frobnicate\nx\n")).toThrow(
      'unsupported CSV column "frobnicate"',
    );
  });

  test("rejects data rows without a name", () => {
    expect(() => csvToRecords("name,places\n,VN\n")).toThrow('row 2: "name" is required');
  });
});
