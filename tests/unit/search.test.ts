import { describe, expect, test } from "bun:test";

import { slugifyName } from "@/modules/food-discovery/server/domain/ids";
import { normalizeSearchKey, pickDisplayName } from "@/modules/food-discovery/server/domain/search";
import {
  decodeBrowseCursor,
  decodeFilterCursor,
  decodeSearchCursor,
  encodeCursor,
} from "@/modules/food-discovery/server/operations/cursor";

describe("normalizeSearchKey", () => {
  test("folds Vietnamese diacritics for search while preserving display names elsewhere", () => {
    expect(normalizeSearchKey("Phở bò")).toBe("pho bo");
    expect(normalizeSearchKey("Bánh mì")).toBe("banh mi");
    expect(normalizeSearchKey("  Pho   BO  ")).toBe("pho bo");
  });

  test("keeps non-Latin scripts rather than destroying them", () => {
    expect(normalizeSearchKey("寿司")).toBe("寿司");
    expect(normalizeSearchKey("비빔밥")).toBe("비빔밥");
    expect(normalizeSearchKey("እንጀራ")).toBe("እንጀራ");
  });

  test("trims to an empty string when nothing searchable remains", () => {
    expect(normalizeSearchKey("  ")).toBe("");
    expect(normalizeSearchKey("!!!")).toBe("");
  });
});

describe("pickDisplayName", () => {
  const names = [
    { languageTag: "vi", name: "Phở", nameKind: "native", isPreferred: true },
    { languageTag: "en", name: "Pho", nameKind: "localized", isPreferred: true },
    { languageTag: "en", name: "pho noodle soup", nameKind: "alias", isPreferred: false },
  ];

  test("prefers the requested locale over the English default", () => {
    expect(pickDisplayName(names, "vi")?.name).toBe("Phở");
    expect(pickDisplayName(names, "en")?.name).toBe("Pho");
  });

  test("falls back to English when the requested locale is absent", () => {
    expect(pickDisplayName(names, "ja")?.name).toBe("Pho");
  });

  test("returns undefined for an empty name list", () => {
    expect(pickDisplayName([], "en")).toBeUndefined();
  });
});

describe("slugifyName", () => {
  test("derives stable lowercase slugs", () => {
    expect(slugifyName("Phở bò")).toBe("pho-bo");
    expect(slugifyName("Jollof rice")).toBe("jollof-rice");
  });

  test("never returns an empty slug", () => {
    expect(slugifyName("!!!")).toBe("dish");
  });
});

describe("cursors", () => {
  test("search cursor round-trips", () => {
    const encoded = encodeCursor({ tier: 1, id: "42" });

    expect(decodeSearchCursor(encoded)).toEqual({ tier: 1, id: "42" });
  });

  test("browse cursor round-trips", () => {
    const encoded = encodeCursor({ updated: "2026-01-01T00:00:00.000Z", id: "7" });

    expect(decodeBrowseCursor(encoded)).toEqual({
      updated: "2026-01-01T00:00:00.000Z",
      id: "7",
    });
  });

  test("filter cursor round-trips", () => {
    const encoded = encodeCursor({ id: "9" });

    expect(decodeFilterCursor(encoded)).toEqual({ id: "9" });
  });

  test("rejects malformed cursors without throwing", () => {
    expect(decodeSearchCursor("not-a-cursor")).toBeNull();
    expect(decodeSearchCursor(undefined)).toBeNull();
    expect(decodeBrowseCursor("!!!")).toBeNull();
    expect(decodeFilterCursor("")).toBeNull();
  });
});
