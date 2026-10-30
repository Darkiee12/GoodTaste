import { menuCopy } from "@/modules/restaurant-discovery/components/menu-copy";
import {
  menuScanDocumentSchema,
  scanPriceSchema,
} from "@/modules/restaurant-discovery/menu-scan.schema";
import type { MenuScanDocument } from "@/modules/restaurant-discovery/menu-scan.schema";

type ScanItem = MenuScanDocument["items"][number];

type ScanVariant = ScanItem["variants"][number];

function VariantEditor({
  variant,
  locale,
  sourceLanguage,
  onChange,
}: {
  readonly variant: ScanVariant;
  readonly locale: string;
  readonly sourceLanguage: string;
  readonly onChange: (variant: ScanVariant) => void;
}) {
  const copy = menuCopy(locale);
  const price = variant.price;
  const priceValid = price === null || scanPriceSchema.safeParse(price).success;

  return (
    <div className="scan-editor-variant">
      {variant.customerAdded === true && <p>{copy.customerAdded}</p>}
      <label htmlFor={`edit-variant-${variant.id}`}>{copy.originalVariant}</label>
      <input
        id={`edit-variant-${variant.id}`}
        lang={sourceLanguage}
        maxLength={200}
        value={variant.originalLabel}
        onChange={(event) => onChange({ ...variant, originalLabel: event.target.value })}
      />
      <label htmlFor={`edit-variant-translation-${variant.id}`}>{copy.translatedVariant}</label>
      <input
        id={`edit-variant-translation-${variant.id}`}
        lang={locale}
        maxLength={300}
        value={variant.translatedLabel ?? ""}
        onChange={(event) =>
          onChange({
            ...variant,
            translatedLabel: event.target.value === "" ? null : event.target.value,
          })
        }
      />
      {price === null ? (
        <>
          <p>{copy.noPrice}</p>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...variant,
                price: { rawText: "", amount: null, currency: null, taxTreatment: "unknown" },
              })
            }
          >
            {copy.enterPrice}
          </button>
        </>
      ) : (
        <>
          <label htmlFor={`edit-raw-price-${variant.id}`}>{copy.rawPrice}</label>
          <input
            id={`edit-raw-price-${variant.id}`}
            maxLength={200}
            value={price.rawText}
            onChange={(event) =>
              onChange({ ...variant, price: { ...price, rawText: event.target.value } })
            }
          />
          <label htmlFor={`edit-amount-${variant.id}`}>{copy.exactAmount}</label>
          <input
            id={`edit-amount-${variant.id}`}
            inputMode="decimal"
            maxLength={49}
            aria-invalid={!priceValid}
            value={price.amount ?? ""}
            onChange={(event) =>
              onChange({
                ...variant,
                price: { ...price, amount: event.target.value === "" ? null : event.target.value },
              })
            }
          />
          <label htmlFor={`edit-currency-${variant.id}`}>{copy.currency}</label>
          <input
            id={`edit-currency-${variant.id}`}
            maxLength={3}
            autoCapitalize="characters"
            aria-invalid={!priceValid}
            value={price.currency ?? ""}
            onChange={(event) =>
              onChange({
                ...variant,
                price: {
                  ...price,
                  currency: event.target.value === "" ? null : event.target.value.toUpperCase(),
                },
              })
            }
          />
          <label htmlFor={`edit-tax-${variant.id}`}>{copy.taxes}</label>
          <select
            id={`edit-tax-${variant.id}`}
            value={price.taxTreatment}
            onChange={(event) => {
              const treatment = scanPriceSchema.shape.taxTreatment.parse(event.target.value);
              onChange({ ...variant, price: { ...price, taxTreatment: treatment } });
            }}
          >
            <option value="unknown">{copy.unknown}</option>
            <option value="included">{copy.included}</option>
            <option value="excluded">{copy.excluded}</option>
          </select>
          <button type="button" onClick={() => onChange({ ...variant, price: null })}>
            {copy.clearPrice}
          </button>
        </>
      )}
    </div>
  );
}

export function ScanEditor({
  document,
  onChange,
}: {
  readonly document: MenuScanDocument;
  readonly onChange: (document: MenuScanDocument) => void;
}) {
  const copy = menuCopy(document.targetLanguage);
  const valid = menuScanDocumentSchema.safeParse(document).success;

  const updateItem = (next: ScanItem): void =>
    onChange({
      ...document,
      items: document.items.map((item) => (item.id === next.id ? next : item)),
    });

  return (
    <section
      className="scan-editor"
      aria-label={copy.edit}
      lang={document.targetLanguage === "vi" ? "vi" : "en"}
    >
      <h2 className="font-display text-3xl">{copy.edit}</h2>
      <p>{copy.editHelp}</p>
      <output>{valid ? copy.valid : copy.invalid}</output>
      {document.items.map((item) => (
        <details className="scan-editor-item" key={item.id}>
          <summary lang={document.sourceLanguage ?? "und"}>{item.originalName}</summary>
          <label htmlFor={`edit-name-${item.id}`}>{copy.originalName}</label>
          <input
            id={`edit-name-${item.id}`}
            required
            maxLength={300}
            lang={document.sourceLanguage ?? "und"}
            value={item.originalName}
            onChange={(event) => updateItem({ ...item, originalName: event.target.value })}
          />
          <label htmlFor={`edit-translation-${item.id}`}>{copy.translatedName}</label>
          <input
            id={`edit-translation-${item.id}`}
            maxLength={300}
            lang={document.targetLanguage}
            value={item.translatedName ?? ""}
            onChange={(event) =>
              updateItem({
                ...item,
                translatedName: event.target.value === "" ? null : event.target.value,
              })
            }
          />
          <label htmlFor={`edit-description-${item.id}`}>{copy.originalDescription}</label>
          <textarea
            id={`edit-description-${item.id}`}
            maxLength={3000}
            lang={document.sourceLanguage ?? "und"}
            value={item.originalDescription ?? ""}
            onChange={(event) =>
              updateItem({
                ...item,
                originalDescription: event.target.value === "" ? null : event.target.value,
              })
            }
          />
          <label htmlFor={`edit-description-translation-${item.id}`}>
            {copy.translatedDescription}
          </label>
          <textarea
            id={`edit-description-translation-${item.id}`}
            maxLength={3000}
            lang={document.targetLanguage}
            value={item.translatedDescription ?? ""}
            onChange={(event) =>
              updateItem({
                ...item,
                translatedDescription: event.target.value === "" ? null : event.target.value,
              })
            }
          />
          {item.variants.map((variant) => (
            <VariantEditor
              key={variant.id}
              variant={variant}
              locale={document.targetLanguage}
              sourceLanguage={document.sourceLanguage ?? "und"}
              onChange={(next) =>
                updateItem({
                  ...item,
                  variants: item.variants.map((entry) => (entry.id === next.id ? next : entry)),
                })
              }
            />
          ))}
          <div className="scan-editor-actions">
            <button
              type="button"
              onClick={() =>
                updateItem({
                  ...item,
                  variants: [
                    ...item.variants,
                    {
                      id: crypto.randomUUID(),
                      customerAdded: true,
                      originalLabel: "",
                      translatedLabel: null,
                      price: null,
                    },
                  ],
                })
              }
            >
              {copy.addVariant}
            </button>
            {item.variants.length > 1 &&
              item.variants.map((entry) => (
                <button
                  key={`remove-${entry.id}`}
                  type="button"
                  aria-label={`${copy.removeVariant}: ${entry.originalLabel}`}
                  onClick={() =>
                    updateItem({
                      ...item,
                      variants: item.variants.filter((variant) => variant.id !== entry.id),
                    })
                  }
                >
                  {copy.removeVariant}: {entry.originalLabel || entry.id.slice(0, 8)}
                </button>
              ))}
          </div>
          {item.customerAdded === true && <p>{copy.customerAdded}</p>}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...document,
                items: document.items.filter((entry) => entry.id !== item.id),
              })
            }
          >
            {copy.removeDish}
          </button>
        </details>
      ))}
      <button
        type="button"
        onClick={() => {
          const page = document.pages[0];

          if (page === undefined) return;

          onChange({
            ...document,
            items: [
              ...document.items,
              {
                id: crypto.randomUUID(),
                customerAdded: true,
                originalName: "",
                translatedName: null,
                originalDescription: null,
                translatedDescription: null,
                explanatorySummary: null,
                ingredients: null,
                sourceReferences: [{ assetId: page.assetId, region: null }],
                uncertainties: [],
                variants: [
                  {
                    id: crypto.randomUUID(),
                    customerAdded: true,
                    originalLabel: "",
                    translatedLabel: null,
                    price: null,
                  },
                ],
              },
            ],
          });
        }}
      >
        {copy.addDish}
      </button>
    </section>
  );
}
