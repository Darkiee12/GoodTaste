import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InteractiveMenuView } from "@/modules/restaurant-discovery/components/interactive-menu";
import { menuCopy, orderIntroductions } from "@/modules/restaurant-discovery/components/menu-copy";
import { ScanEditor } from "@/modules/restaurant-discovery/components/scan-editor";
import { WaiterOrderCard } from "@/modules/restaurant-discovery/components/waiter-order-card";
import {
  MenuSubtotal,
  menuSubtotal,
  orderLines,
  presentScan,
} from "@/modules/restaurant-discovery/menu-presentation";
import type {
  InteractiveMenu,
  MenuSelection,
} from "@/modules/restaurant-discovery/menu-presentation";
import { menuScanDocumentSchema } from "@/modules/restaurant-discovery/menu-scan.schema";
import type { MenuScanDocument } from "@/modules/restaurant-discovery/menu-scan.schema";
import { formatMoney } from "@/shared/money";

const assetId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const regularId = "00000000-0000-4000-8000-000000000003";
const largeId = "00000000-0000-4000-8000-000000000004";

const document = (): MenuScanDocument =>
  menuScanDocumentSchema.parse({
    schemaVersion: 1,
    sourceLanguage: "vi",
    targetLanguage: "en",
    menuTitle: "Thực đơn thử nghiệm",
    orderIntroduction: {
      original: "Cho chúng tôi gọi các món sau.",
      translated: "We would like these dishes, please.",
    },
    pages: [{ assetId, pageNumber: 1 }],
    items: [
      {
        id: itemId,
        originalName: "Phở bò",
        translatedName: "Beef noodle soup",
        originalDescription: "Nước dùng bò",
        translatedDescription: "Beef broth",
        explanatorySummary: "A noodle soup; confirm ingredients with the waiter.",
        ingredients: [{ originalText: "Bò", translatedText: "Beef", evidence: "printed" }],
        variants: [
          {
            id: regularId,
            originalLabel: "Tô thường",
            translatedLabel: "Regular bowl",
            price: {
              rawText: "65.000đ",
              amount: "65000",
              currency: "VND",
              taxTreatment: "unknown",
            },
          },
          {
            id: largeId,
            originalLabel: "Tô lớn",
            translatedLabel: "Large bowl",
            price: {
              rawText: "80.000đ",
              amount: "80000",
              currency: "VND",
              taxTreatment: "unknown",
            },
          },
        ],
        sourceReferences: [{ assetId, region: null }],
        uncertainties: ["Tax treatment is not printed"],
      },
    ],
  });

const select = (variantId: string, quantity: number): MenuSelection => ({
  variantId,
  quantity,
  instruction: "",
  originalLanguageInstruction: "",
});

const pricedMenu = (amount: string | null, currency: string | null): InteractiveMenu => {
  const scan = document();
  scan.items = scan.items.map((item) => ({
    ...item,
    variants: item.variants.map((variant) => ({
      ...variant,
      price: { rawText: "Synthetic price", amount, currency, taxTreatment: "unknown" },
    })),
  }));

  return presentScan(scan, null);
};

const calculated = (menu: InteractiveMenu, selections: ReadonlyArray<MenuSelection>) =>
  MenuSubtotal.$match(menuSubtotal(menu, selections), {
    Calculable: (total) => ({ amount: total.amount, currency: total.currency }),
    Empty: () => null,
    Unavailable: () => null,
  });

describe("exact menu order arithmetic", () => {
  test("preserves variant prices and multiplies quantities independently", () => {
    const menu = presentScan(document(), "Synthetic venue");
    const selected = [select(regularId, 2), select(largeId, 1)];
    expect(orderLines(menu, selected).map((line) => line.lineAmount)).toEqual(["130000", "80000"]);
    expect(calculated(menu, selected)).toEqual({ amount: "210000", currency: "VND" });
  });

  test("large amounts never pass through Number", () => {
    expect(
      calculated(pricedMenu("999999999999999999999999999999.9999", "CLF"), [select(regularId, 99)]),
    ).toEqual({ amount: "98999999999999999999999999999999.9901", currency: "CLF" });
  });

  test("zero-priced items are calculable", () => {
    expect(calculated(pricedMenu("0", "JPY"), [select(regularId, 2)])).toEqual({
      amount: "0",
      currency: "JPY",
    });
  });

  test("fractional amounts add exactly", () => {
    expect(
      calculated(pricedMenu("0.10", "USD"), [select(regularId, 3), select(largeId, 7)]),
    ).toEqual({ amount: "1.00", currency: "USD" });
  });

  test("subtotal does not round original observations", () => {
    const total = calculated(pricedMenu("0.005", "USD"), [select(regularId, 3)]);
    expect(total).toEqual({ amount: "0.015", currency: "USD" });
    expect(formatMoney("0.015", "USD", "en")).toBe("$0.015");
  });

  test("currency minor units remain visible without losing observation precision", () => {
    expect(formatMoney("123", "JPY", "en")).toBe("¥123");
    expect(formatMoney("1.2", "KWD", "en")).toContain("1.200");
    expect(formatMoney("1.2345", "CLF", "en")).toContain("1.2345");
  });

  test("missing amounts never become zero", () => {
    expect(
      MenuSubtotal.$is("Unavailable")(
        menuSubtotal(pricedMenu(null, "VND"), [select(regularId, 1)]),
      ),
    ).toBe(true);
    expect(orderLines(pricedMenu(null, "VND"), [select(regularId, 1)])[0]?.lineAmount).toBeNull();
  });

  test("missing and unsupported currencies cannot produce authoritative totals", () => {
    expect(
      MenuSubtotal.$is("Unavailable")(menuSubtotal(pricedMenu("1", null), [select(regularId, 1)])),
    ).toBe(true);
    expect(
      MenuSubtotal.$is("Unavailable")(menuSubtotal(pricedMenu("1", "BTC"), [select(regularId, 1)])),
    ).toBe(true);
  });

  test("mixed currencies stay separate", () => {
    const scan = document();
    scan.items = scan.items.map((item) => ({
      ...item,
      variants: item.variants.map((variant) => ({
        ...variant,
        price: {
          rawText: "Synthetic mixed currency",
          amount: "1",
          currency: variant.id === regularId ? "USD" : "JPY",
          taxTreatment: "unknown",
        },
      })),
    }));
    expect(
      MenuSubtotal.$is("Unavailable")(
        menuSubtotal(presentScan(scan, null), [select(regularId, 1), select(largeId, 1)]),
      ),
    ).toBe(true);
  });

  test("empty orders are distinct from zero totals", () => {
    expect(MenuSubtotal.$is("Empty")(menuSubtotal(pricedMenu("0", "VND"), []))).toBe(true);
  });

  test("rejects missing variants, duplicate lines and invalid quantities", () => {
    const menu = pricedMenu("1", "USD");

    for (const quantity of [0, -1, 1.5, 100, Number.NaN])
      expect(() => orderLines(menu, [select(regularId, quantity)])).toThrow(RangeError);
    expect(() => orderLines(menu, [select("missing", 1)])).toThrow(RangeError);
    expect(() => orderLines(menu, [select(regularId, 1), select(regularId, 1)])).toThrow(
      RangeError,
    );
  });
});

describe("deterministic menu presentation", () => {
  test("scan projection preserves raw text, uncertainty and full-page references", () => {
    const menu = presentScan(document(), null);
    expect(menu.provenance).toBe("private_scan");
    expect(menu.items[0]?.variants[0]?.price?.rawText).toBe("65.000đ");
    expect(menu.items[0]?.assetIds).toEqual([assetId]);
    expect(menu.items[0]?.uncertainties).toEqual(["Tax treatment is not printed"]);
  });

  test("the renderer preserves original names and labelled quantity controls", () => {
    const html = renderToStaticMarkup(
      <InteractiveMenuView
        menu={presentScan(document(), "Venue")}
        locale="en"
        photoUrl={(id) => `/private/assets/${id}`}
      />,
    );

    expect(html).toContain('lang="vi">Phở bò');
    expect(html).toContain("Beef noodle soup");
    expect(html).toContain("Add one: Phở bò");
    expect(html).toContain("Unverified menu extraction");
    expect(html).toContain("Tax treatment is not printed");
    expect(html).toContain(`/private/assets/${assetId}`);
    expect(html).toContain("Show waiter card");
    expect(html).toContain("disabled");
  });

  test("waiter card prioritizes original names, quantities and variant-specific estimates", () => {
    const html = renderToStaticMarkup(
      <WaiterOrderCard
        menu={presentScan(document(), "Synthetic venue")}
        selections={[
          {
            ...select(largeId, 2),
            instruction: "No coriander, please",
            originalLanguageInstruction: "Không rau mùi, vui lòng",
          },
        ]}
        locale="en"
      />,
    );

    expect(html).toContain("Synthetic venue");
    expect(html).toContain("2 ×");
    expect(html).toContain("Tô lớn");
    expect(html).toContain("160,000");
    expect(html).toContain("Không rau mùi, vui lòng");
    expect(html).toContain("No coriander, please");
    expect(html).toContain("No order has been submitted");
    expect(html).toContain("taxes, service charges");
  });

  test("unknown amounts are visible in both menu and waiter card", () => {
    const menu = pricedMenu(null, null);
    expect(renderToStaticMarkup(<InteractiveMenuView menu={menu} locale="en" />)).toContain(
      "Price unknown",
    );

    const html = renderToStaticMarkup(
      <WaiterOrderCard menu={menu} selections={[select(regularId, 1)]} locale="en" />,
    );

    expect(html).toContain("Price unknown");
    expect(html).not.toContain("Estimated menu subtotal:");
  });

  test("missing translations keep CJK original names without synthetic text", () => {
    const scan = document();
    scan.sourceLanguage = "ja";
    scan.items = scan.items.map((item) => ({
      ...item,
      originalName: "特製季節の野菜ときのこのうどん",
      translatedName: null,
    }));

    const html = renderToStaticMarkup(
      <InteractiveMenuView menu={presentScan(scan, null)} locale="vi" />,
    );

    expect(html).toContain('lang="ja">特製季節の野菜ときのこのうどん');
    expect(html).not.toContain("Beef noodle soup");
    expect(html).toContain("Chọn món của bạn");
  });

  test("untrusted extracted text is escaped by React", () => {
    const scan = document();
    scan.items = scan.items.map((item) => ({
      ...item,
      originalName: '<script>alert("menu")</script>',
    }));

    const html = renderToStaticMarkup(
      <InteractiveMenuView menu={presentScan(scan, null)} locale="en" />,
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("editor retains original and translated fields with exact-price inputs", () => {
    const html = renderToStaticMarkup(<ScanEditor document={document()} onChange={() => {}} />);
    expect(html).toContain("Correct the scan");
    expect(html).toContain("65.000đ");
    expect(html).toContain('value="65000"');
    expect(html).toContain("ISO currency code");
    expect(html).toContain("private and unverified");
    expect(html).toContain('inputMode="decimal"');
  });

  test("bounded malformed price corrections are visibly invalid instead of guessed", () => {
    const scan = document();
    scan.items = scan.items.map((item) => ({
      ...item,
      variants: item.variants.map((variant) => ({
        ...variant,
        price: { rawText: "1,25", amount: "1,25", currency: "XYZ", taxTreatment: "unknown" },
      })),
    }));
    const html = renderToStaticMarkup(<ScanEditor document={scan} onChange={() => {}} />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("incomplete or invalid");
    expect(
      renderToStaticMarkup(<InteractiveMenuView menu={presentScan(scan, null)} locale="en" />),
    ).toContain("Price unknown");
  });

  test("all seven supported menu languages have app-owned order introductions", () => {
    for (const locale of ["en", "vi", "ja", "zh", "ko", "fr", "es"])
      expect(orderIntroductions.has(locale)).toBe(true);
    expect(menuCopy("vi").show).toBe("Đưa phiếu cho nhân viên xem");
    expect(menuCopy("unsupported").show).toBe(menuCopy("en").show);
  });
});
