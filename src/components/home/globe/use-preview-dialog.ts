import { useEffect, useRef, type RefObject } from "react";

import type { FoodLocation } from "@/components/home/globe/food-locations";

/**
 * Preview dialog behavior: move focus to the heading when it opens and
 * dismiss on Escape. Returns the heading ref for the overlay to attach.
 */
export function usePreviewDialog(
  preview: FoodLocation | null,
  onClosePreview: () => void,
): RefObject<HTMLParagraphElement | null> {
  const headingRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (preview) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [preview]);

  useEffect(() => {
    if (!preview) {
      return undefined;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClosePreview();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [preview, onClosePreview]);

  return headingRef;
}
