import { BigDecimal, Data } from "effect";

import type { MenuScanDocument } from "@/modules/restaurant-discovery/menu-scan.schema";
import { isAmount, isCurrency } from "@/shared/money";

/** One browser-safe presentation contract for reviewed rows and private drafts. */
export interface InteractiveMenu {
  readonly venueName: string | null;
  readonly sourceLanguage: string | null;
  readonly targetLanguage: string;
  readonly introduction: { readonly original: string | null; readonly translated: string | null };
  readonly provenance: "reviewed" | "private_scan";
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly originalName: string;
    readonly translatedName: string | null;
    readonly originalDescription: string | null;
    readonly translatedDescription: string | null;
    readonly explanatorySummary: string | null;
    readonly uncertainties: ReadonlyArray<string>;
    readonly assetIds: ReadonlyArray<string>;
    readonly dishId: string | null;
    readonly variants: ReadonlyArray<{
      readonly id: string;
      readonly originalLabel: string;
      readonly translatedLabel: string | null;
      readonly price: {
        readonly rawText: string;
        readonly amount: string | null;
        readonly currency: string | null;
        readonly taxTreatment: string;
      } | null;
      readonly provenance: string;
    }>;
  }>;
}

export const presentScan = (
  document: MenuScanDocument,
  venueName: string | null,
): InteractiveMenu => ({
  venueName,
  sourceLanguage: document.sourceLanguage,
  targetLanguage: document.targetLanguage,
  introduction: document.orderIntroduction,
  provenance: "private_scan",
  items: document.items.map((item) => ({
    ...item,
    assetIds: item.sourceReferences.map((reference) => reference.assetId),
    dishId: null,
    variants: item.variants.map((variant) => ({
      ...variant,
      provenance: "Unverified menu extraction",
    })),
  })),
});

export interface MenuSelection {
  readonly variantId: string;
  readonly quantity: number;
  readonly instruction: string;
  readonly originalLanguageInstruction: string;
}

export type MenuSubtotal = Data.TaggedEnum<{
  Empty: {};
  Unavailable: { readonly reason: string };
  Calculable: { readonly amount: string; readonly currency: string };
}>;

export const MenuSubtotal = Data.taggedEnum<MenuSubtotal>();

export const exactDecimalText = (value: BigDecimal.BigDecimal): string => {
  if (value.scale <= 0) return (value.value * 10n ** BigInt(-value.scale)).toString();
  const digits = value.value.toString().padStart(value.scale + 1, "0");

  return `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
};

export function orderLines(menu: InteractiveMenu, selections: ReadonlyArray<MenuSelection>) {
  const variants = new Map(
    menu.items.flatMap((item) =>
      item.variants.map((variant) => [variant.id, { item, variant }] as const),
    ),
  );

  const seen = new Set<string>();

  return selections.map((selection) => {
    const offering = variants.get(selection.variantId);

    if (
      offering === undefined ||
      seen.has(selection.variantId) ||
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > 99
    ) {
      throw new RangeError("Invalid menu selection");
    }

    seen.add(selection.variantId);
    const price = offering.variant.price;
    let lineAmount: string | null = null;

    if (price?.amount !== null && price?.amount !== undefined && isAmount(price.amount)) {
      lineAmount = exactDecimalText(
        BigDecimal.multiply(
          BigDecimal.fromStringUnsafe(price.amount),
          BigDecimal.fromBigInt(BigInt(selection.quantity)),
        ),
      );
    }

    return { ...offering, ...selection, lineAmount };
  });
}

export function menuSubtotal(
  menu: InteractiveMenu,
  selections: ReadonlyArray<MenuSelection>,
): MenuSubtotal {
  const lines = orderLines(menu, selections);

  if (lines.length === 0) return MenuSubtotal.Empty();
  let currency: string | undefined;
  let total = BigDecimal.fromBigInt(0n);

  for (const line of lines) {
    const price = line.variant.price;

    if (
      line.lineAmount === null ||
      price === null ||
      price.currency === null ||
      !isCurrency(price.currency)
    ) {
      return MenuSubtotal.Unavailable({
        reason: "Some prices or currencies are unknown. Confirm with the waiter.",
      });
    }

    if (currency !== undefined && currency !== price.currency) {
      return MenuSubtotal.Unavailable({
        reason: "Prices use different currencies; no single subtotal is available.",
      });
    }

    currency = price.currency;
    total = BigDecimal.sum(total, BigDecimal.fromStringUnsafe(line.lineAmount));
  }

  if (currency === undefined) throw new RangeError("Selected lines have no currency");

  return MenuSubtotal.Calculable({ amount: exactDecimalText(total), currency });
}
