import { describe, expect, test } from "bun:test";

import { detectBrowserLocale } from "@/shared/i18n";

describe("browser locale default", () => {
  test("picks fully translated non-English locales first", () => {
    expect(detectBrowserLocale(["vi-VN", "vi", "en"])).toBe("vi");
    expect(detectBrowserLocale(["fr-FR", "vi"])).toBe("vi");
  });

  test("never navigates for English or unmatched languages", () => {
    expect(detectBrowserLocale(["en-US", "en"])).toBeNull();
    expect(detectBrowserLocale(["fr-FR", "de"])).toBeNull();
    expect(detectBrowserLocale([])).toBeNull();
    expect(detectBrowserLocale(undefined)).toBeNull();
  });

  test("does not advertise partially translated locales as defaults", () => {
    expect(detectBrowserLocale(["hi", "en"])).toBeNull();
    expect(detectBrowserLocale(["es-ES"])).toBeNull();
    expect(detectBrowserLocale(["zh-CN"])).toBeNull();
  });
});
