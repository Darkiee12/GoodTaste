import { useEffect, useRef, useState, type RefObject } from "react";

import {
  FOOD_LOCATIONS,
  SURPRISE_DISH_EVENT,
  type FoodLocation,
} from "@/components/home/globe/food-locations";
import type { GlobeOverlayBridge } from "@/components/home/globe/geo-utils";
import type { ActiveDish } from "@/components/home/globe/globe-food-overlay";
import type { Messages } from "@/shared/i18n";

const DISH_SHOW_MS = 3200;
const DISH_EXIT_MS = 380;

export type GlobeDishes = {
  active: ActiveDish | null;
  preview: FoodLocation | null;
  announcement: string;
  handleActiveDish: (id: string | null) => void;
  handleOpenPreview: (dish: FoodLocation) => void;
  handleClosePreview: () => void;
  handleShowAnother: () => void;
};

/**
 * Dish scheduling UI state for the hero globe: the timed popup lifecycle,
 * the preview dialog, and screen-reader announcements. Pure behavior — the
 * scene component only renders what this returns.
 */
export function useGlobeDishes(
  bridgeRef: RefObject<GlobeOverlayBridge>,
  copy: Messages,
): GlobeDishes {
  const [active, setActive] = useState<ActiveDish | null>(null);
  const [preview, setPreview] = useState<FoodLocation | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<Array<number>>([]);

  useEffect(() => {
    const pending = timers.current;

    return () => {
      for (const timer of pending) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    bridgeRef.current.paused = preview !== null;
  }, [preview, bridgeRef]);

  const clearTimers = () => {
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }

    timers.current = [];
  };

  const handleActiveDish = (id: string | null) => {
    clearTimers();

    if (id === null) {
      setActive((current) => (current ? { dish: current.dish, exiting: true } : current));
      timers.current.push(
        window.setTimeout(() => {
          setActive(null);
        }, DISH_EXIT_MS),
      );

      return;
    }

    const dish = FOOD_LOCATIONS.find((candidate) => candidate.id === id);

    if (!dish) {
      return;
    }

    setActive({ dish, exiting: false });
    timers.current.push(
      window.setTimeout(() => {
        handleActiveDish(null);
      }, DISH_SHOW_MS),
    );
  };

  const handleOpenPreview = (dish: FoodLocation) => {
    clearTimers();
    setActive(null);
    setPreview(dish);
    setAnnouncement(copy.previewOpened);
  };

  const handleClosePreview = () => {
    setPreview(null);
    bridgeRef.current.activeId = null;
    setAnnouncement(copy.previewClosed);
    document.getElementById("surprise-dish-button")?.focus({ preventScroll: true });
  };

  const handleShowAnother = () => {
    setPreview(null);
    bridgeRef.current.activeId = null;
    document.getElementById("surprise-dish-button")?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent(SURPRISE_DISH_EVENT));
  };

  return {
    active,
    preview,
    announcement,
    handleActiveDish,
    handleOpenPreview,
    handleClosePreview,
    handleShowAnother,
  };
}
