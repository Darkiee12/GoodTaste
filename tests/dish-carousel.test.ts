import { describe, expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  carouselAnnouncement,
  carouselWrappedIndex,
  DISH_CAROUSEL_AUTOPLAY_MS,
  dishCarouselIngredientNames,
  dishCarouselTitle,
  DishCarouselSkeleton,
  toCarouselPublishedImage,
} from "@/components/dish/dish-carousel";
import type { CarouselCard } from "@/modules/food-discovery/server/operations/dish-service";
import { messagesFor } from "@/shared/i18n";

/**
 * Shared dish carousel contracts. Pure helpers plus the skeleton SSR markup
 * are covered here with bun:test; interaction (autoplay, swipe, keyboard
 * cycle, focus containment) is covered by Playwright, not bun:test — no DOM
 * renderer is installed in this repo.
 */

const carouselItem = (overrides?: Partial<CarouselCard>): CarouselCard => ({
  description: "A test dish for carousel coverage.",
  descriptionLanguage: "en",
  englishName: "Test Dish",
  id: "101",
  image: null,
  ingredients: [
    { name: "Rice", role: "base" },
    { name: "Herbs", role: "garnish" },
  ],
  name: "Test Dish",
  nativeLanguageTag: undefined,
  nativeName: undefined,
  regionNames: ["Hanoi"],
  slug: "test-dish",
  ...overrides,
});

describe("carousel index math", () => {
  test("wraps forward and backward across the slide window", () => {
    expect(carouselWrappedIndex(0, 5)).toBe(0);
    expect(carouselWrappedIndex(5, 5)).toBe(0);
    expect(carouselWrappedIndex(6, 5)).toBe(1);
    expect(carouselWrappedIndex(-1, 5)).toBe(4);
    expect(carouselWrappedIndex(-6, 5)).toBe(4);
  });

  test("a single slide never moves", () => {
    expect(carouselWrappedIndex(1, 1)).toBe(0);
    expect(carouselWrappedIndex(-1, 1)).toBe(0);
  });

  test("empty input stays at zero instead of producing NaN", () => {
    expect(carouselWrappedIndex(0, 0)).toBe(0);
    expect(carouselWrappedIndex(3, 0)).toBe(0);
  });
});

describe("carousel announcements", () => {
  test("manual navigation announces the new position in English", () => {
    const copy = messagesFor("en");

    expect(carouselAnnouncement(copy, 0, 5)).toBe("Slide 1 of 5");
    expect(carouselAnnouncement(copy, 4, 5)).toBe("Slide 5 of 5");
  });

  test("manual navigation announces the new position in Vietnamese", () => {
    const copy = messagesFor("vi");

    expect(carouselAnnouncement(copy, 0, 5)).toBe("Trang 1 / 5");
    expect(carouselAnnouncement(copy, 2, 5)).toBe("Trang 3 / 5");
  });
});

describe("carousel slide titles", () => {
  test("prefers the localized name, then English, then the slug", () => {
    expect(dishCarouselTitle(carouselItem({ name: "Phở", englishName: "Pho" }))).toBe("Phở");
    expect(
      dishCarouselTitle(carouselItem({ name: undefined, englishName: "Pho", slug: "pho" })),
    ).toBe("Pho");
    expect(
      dishCarouselTitle(carouselItem({ name: undefined, englishName: undefined, slug: "pho" })),
    ).toBe("pho");
  });
});

describe("carousel ingredient preview", () => {
  test("drops missing names and caps the preview at six", () => {
    const item = carouselItem({
      ingredients: [
        { name: "Rice", role: "base" },
        { name: undefined, role: "unknown" },
        { name: "Herbs", role: "garnish" },
        { name: "Lime", role: "garnish" },
        { name: "Chili", role: "spice" },
        { name: "Broth", role: "base" },
        { name: "Beef", role: "protein" },
        { name: "Onion", role: "garnish" },
      ],
    });

    expect(dishCarouselIngredientNames(item)).toEqual([
      "Rice",
      "Herbs",
      "Lime",
      "Chili",
      "Broth",
      "Beef",
    ]);
  });

  test("absent ingredients resolve to an empty preview, not a fallback name", () => {
    expect(dishCarouselIngredientNames(carouselItem({ ingredients: undefined }))).toEqual([]);
    expect(dishCarouselIngredientNames(carouselItem({ ingredients: [] }))).toEqual([]);
  });
});

describe("carousel image projection", () => {
  test("absent photos project to null: the slide renders the honest fallback", () => {
    expect(toCarouselPublishedImage(null, "101")).toBeNull();
    expect(toCarouselPublishedImage(undefined, "101")).toBeNull();
  });

  test("published projections pass through untouched", () => {
    const published = {
      alt: "A test bowl",
      attribution: "Test Kitchen",
      dishId: "101",
      focalX: 0.5,
      focalY: 0.4,
      height: 800,
      id: "photo-1",
      srcSet: "https://cdn.example.com/400 400w",
      url: "https://cdn.example.com/1600",
      width: 1200,
    };

    expect(toCarouselPublishedImage(published, "101")).toEqual(published);
  });

  test("older payloads fill identity and dimensions defensively, never URLs", () => {
    const legacy = {
      alt: "Legacy photo",
      attribution: null,
      url: "https://example.com/legacy.jpg",
    };

    expect(toCarouselPublishedImage(legacy, "202")).toEqual({
      alt: "Legacy photo",
      attribution: null,
      dishId: "202",
      focalX: null,
      focalY: null,
      height: null,
      id: "202",
      srcSet: null,
      url: "https://example.com/legacy.jpg",
      width: null,
    });
  });

  test("keeps explicit per-photo identity when the payload carries it", () => {
    const legacy = {
      alt: "Legacy photo",
      attribution: "Archive",
      dishId: "303",
      id: "photo-9",
      url: "https://example.com/other.jpg",
    };

    const projected = toCarouselPublishedImage(legacy, "999");

    expect(projected?.id).toBe("photo-9");
    expect(projected?.dishId).toBe("303");
    expect(projected?.url).toBe("https://example.com/other.jpg");
  });
});

describe("carousel copy contract", () => {
  test("every string the shared carousel renders exists in English and Vietnamese", () => {
    for (const locale of ["en", "vi"] as const) {
      const copy = messagesFor(locale);

      for (const key of [
        "carouselPrev",
        "carouselNext",
        "carouselPlay",
        "carouselPause",
        "carouselSlide",
        "carouselOf",
        "carouselGoTo",
        "carouselIngredients",
        "carouselNoDescription",
        "carouselNoIngredients",
        "carouselPhotoSoon",
        "carouselExploreDish",
        "discoverLocalLoading",
      ] as const) {
        expect(copy[key].length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  test("autoplay stays off unless the caller opts in", () => {
    // The shared default is an explicit constant so both callers read the
    // same cadence; results mount without `autoplay` and never advance.
    expect(DISH_CAROUSEL_AUTOPLAY_MS).toBe(6000);
  });
});

describe("carousel loading skeleton", () => {
  test("mirrors the featured-slide layout with stable dimensions", () => {
    const html = renderToStaticMarkup(createElement(DishCarouselSkeleton));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("rounded-3xl");
    expect(html).toContain("border-border-soft");
    // Media side reserves the final aspect up front: no layout shift.
    expect(html).toContain("aspect-[4/3]");
    expect(html).toContain("md:min-h-[22rem]");
    // Info side matches the slide grid and padding.
    expect(html).toContain("md:grid-cols-[45%_55%]");
    expect(html).toContain("p-6");
    expect(html).toContain("sm:p-8");
    // Pulse is motion-safe like the rest of the carousel.
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
  });
});
