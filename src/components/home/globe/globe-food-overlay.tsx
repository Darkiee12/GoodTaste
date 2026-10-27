import { useCallback, type RefObject } from "react";

import { localizedDishText, type FoodLocation } from "@/components/home/globe/food-locations";
import type { GlobeOverlayBridge } from "@/components/home/globe/geo-utils";
import { usePreviewDialog } from "@/components/home/globe/use-preview-dialog";
import type { Locale, Messages } from "@/shared/i18n";

export type ActiveDish = {
  dish: FoodLocation;
  exiting: boolean;
};

function PopupStem() {
  return (
    <span
      aria-hidden="true"
      className="mx-auto block h-2.5 w-2.5 -translate-y-1 rotate-45 bg-food-orange"
    />
  );
}

/** DOM popup and preview cards positioned each frame from real 3D anchors. */
export function GlobeFoodOverlay({
  copy,
  lang,
  bridgeRef,
  active,
  preview,
  announcement,
  onOpenPreview,
  onClosePreview,
  onShowAnother,
}: {
  copy: Messages;
  lang: Locale;
  bridgeRef: RefObject<GlobeOverlayBridge>;
  active: ActiveDish | null;
  preview: FoodLocation | null;
  announcement: string;
  onOpenPreview: (dish: FoodLocation) => void;
  onClosePreview: () => void;
  onShowAnother: () => void;
}) {
  const headingRef = usePreviewDialog(preview, onClosePreview);

  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      bridgeRef.current.node = node;
    },
    [bridgeRef],
  );

  return (
    <>
      {active && !preview ? (
        <div
          ref={setNode}
          className="pointer-events-none absolute top-0 left-0 flex -translate-x-1/2 -translate-y-full flex-col items-center"
        >
          <button
            type="button"
            onClick={() => {
              onOpenPreview(active.dish);
            }}
            aria-label={`${active.dish.name}, ${localizedDishText(active.dish.country, lang)}. ${copy.popupHint}`}
            className={`pointer-events-auto flex cursor-pointer items-center gap-3 rounded-2xl border border-border-soft bg-white py-2 pr-4 pl-2 text-left text-ink shadow-[0_16px_40px_rgba(3,10,30,0.45)] transition-colors hover:border-food-orange ${
              active.exiting ? "motion-safe:animate-popup-exit" : "motion-safe:animate-popup-enter"
            }`}
          >
            <span
              aria-hidden="true"
              className="grid h-11 w-11 flex-none place-items-center rounded-full bg-cream text-[1.6rem]"
            >
              {active.dish.emoji}
            </span>

            <span className="flex flex-col py-0.5 pr-1 leading-tight">
              <span className="text-base font-extrabold whitespace-nowrap">{active.dish.name}</span>
              <span className="text-sm whitespace-nowrap text-muted">
                {localizedDishText(active.dish.country, lang)}
              </span>
            </span>
          </button>

          <PopupStem />
        </div>
      ) : null}

      {preview ? (
        <div
          ref={setNode}
          className="pointer-events-none absolute top-0 left-0 flex -translate-x-1/2 -translate-y-full flex-col items-center"
        >
          <dialog
            open
            aria-labelledby="food-preview-name"
            className="static m-0 max-w-none border-0 bg-transparent p-0"
          >
            <div className="pointer-events-auto w-[min(19rem,78vw)] origin-bottom rounded-2xl border border-border-soft bg-white p-4 text-left text-ink shadow-[0_20px_48px_rgba(3,10,30,0.5)] motion-safe:animate-popup-enter">
              <div className="mb-2 flex items-center gap-3">
                <span aria-hidden="true" className="text-3xl leading-none">
                  {preview.emoji}
                </span>

                <div>
                  <p
                    id="food-preview-name"
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-lg leading-tight font-extrabold focus:outline-none"
                  >
                    {preview.name}
                  </p>

                  <p className="text-sm text-muted">
                    {localizedDishText(preview.country, lang)} ·{" "}
                    {localizedDishText(preview.region, lang)}
                  </p>
                </div>
              </div>

              <p className="mb-4 text-[0.95rem]">{localizedDishText(preview.description, lang)}</p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onShowAnother}
                  className="min-h-11 cursor-pointer rounded-full bg-food-orange-strong px-4 text-sm font-bold text-white hover:bg-food-orange-dark"
                >
                  {copy.previewShowAnother}
                </button>

                <button
                  type="button"
                  onClick={onClosePreview}
                  className="min-h-11 cursor-pointer rounded-full border-2 border-border-soft bg-transparent px-4 text-sm font-bold text-ink hover:border-muted"
                >
                  {copy.previewClose}
                </button>
              </div>
            </div>
          </dialog>

          <PopupStem />
        </div>
      ) : null}

      <output className="sr-only">{announcement}</output>
    </>
  );
}
