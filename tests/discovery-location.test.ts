import { describe, expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  discoveryBackLabelFor,
  discoveryHeadingFor,
  discoveryLocationCopyFor,
  discoveryServedScopeFor,
  discoverySubtitleFor,
  DiscoveryLocation,
  type DiscoveryLocationProps,
} from "@/components/home/discovery-location";

/**
 * Location selector contracts. Pure scope/heading helpers plus the SSR
 * indicator markup are covered here with bun:test; menu interaction
 * (open, keyboard, submenu, dismissal) rides on Radix primitives and is
 * covered by browser checks, not bun:test — no DOM renderer is installed.
 */

/** Every key of DiscoveryLocationCopy, so copy tests stay exhaustive. */
const COPY_KEYS = [
  "backToRegion",
  "backToRegionNamed",
  "changeLocation",
  "chooseDestination",
  "deniedNote",
  "destinationsEmpty",
  "destinationsLoading",
  "exploreWorldwide",
  "headingNearby",
  "headingRegional",
  "headingRegionalNamed",
  "headingWorldwide",
  "locatingNote",
  "menuLabel",
  "preciseUnavailable",
  "subNearby",
  "subRegional",
  "subRegionalNamed",
  "subSupplementedNamed",
  "subWorldwide",
  "usePrecise",
] as const;

/** Phrases that must never reach a visitor in either language. */
const BANNED_PHRASES = [
  "network region",
  "precise fix",
  "IP-derived",
  "Cloudflare",
  "lat-lon",
  "Near your precise location",
  "vùng mạng",
  "khu vực mạng",
  "vị trí chính xác",
] as const;

const baseProps = (overrides?: Partial<DiscoveryLocationProps>): DiscoveryLocationProps => ({
  countries: [
    { code: "VN", label: "Vietnam" },
    { code: "TH", label: "Thailand" },
  ],
  countriesLoading: false,
  currentLabel: "Vietnam",
  disabled: false,
  lang: "en",
  locating: false,
  preciseDenied: false,
  preciseDisabled: false,
  onBackToRegion: () => {},
  onChooseCountry: () => {},
  onExploreWorldwide: () => {},
  onUsePrecise: () => {},
  selectedCountry: "VN",
  selection: "regional",
  showBackToRegion: false,
  ...overrides,
});

describe("served scope honesty", () => {
  test("served nearby with an active fix is nearby", () => {
    expect(discoveryServedScopeFor({ preciseActive: true, servedScope: "nearby" })).toBe("nearby");
  });

  test("a precise request served as country dishes stays regional", () => {
    expect(discoveryServedScopeFor({ preciseActive: true, servedScope: "country" })).toBe(
      "regional",
    );
  });

  test("served nearby without an active fix is regional, not nearby", () => {
    expect(discoveryServedScopeFor({ preciseActive: false, servedScope: "nearby" })).toBe(
      "regional",
    );
  });

  test("a supplemented nearby pool is regional even with an active fix", () => {
    expect(
      discoveryServedScopeFor({ preciseActive: true, servedScope: "nearby", supplemented: true }),
    ).toBe("regional");
  });

  test("supplemented worldwide stays worldwide", () => {
    expect(
      discoveryServedScopeFor({
        preciseActive: true,
        servedScope: "worldwide",
        supplemented: true,
      }),
    ).toBe("worldwide");
  });

  test("served worldwide stays worldwide even with an active fix", () => {
    expect(discoveryServedScopeFor({ preciseActive: true, servedScope: "worldwide" })).toBe(
      "worldwide",
    );
  });

  test("nothing served yet resolves to null so the lead keeps prior copy", () => {
    expect(discoveryServedScopeFor({ preciseActive: false, servedScope: null })).toBeNull();
  });
});

describe("headings keyed off the served scope", () => {
  test("regional names the served country in English and Vietnamese", () => {
    expect(discoveryHeadingFor({ lang: "en", regionName: "Vietnam", scope: "regional" })).toBe(
      "Discover dishes from Vietnam",
    );
    expect(discoveryHeadingFor({ lang: "vi", regionName: "Việt Nam", scope: "regional" })).toBe(
      "Khám phá món ngon tại Việt Nam",
    );
  });

  test("regional without a name falls back to the region heading", () => {
    expect(discoveryHeadingFor({ lang: "en", regionName: null, scope: "regional" })).toBe(
      "Discover dishes from this region",
    );
    expect(discoveryHeadingFor({ lang: "vi", regionName: "", scope: "regional" })).toBe(
      "Khám phá món ngon vùng này",
    );
  });

  test("worldwide and nearby headings never name a locality they cannot prove", () => {
    expect(discoveryHeadingFor({ lang: "en", regionName: "Vietnam", scope: "worldwide" })).toBe(
      "A taste from around the world",
    );
    expect(discoveryHeadingFor({ lang: "vi", regionName: "Việt Nam", scope: "nearby" })).toBe(
      "Món ngon gần bạn",
    );
    expect(discoveryHeadingFor({ lang: "en", regionName: null, scope: "nearby" })).toBe(
      "Dishes near you",
    );
  });
});

describe("subtitles keyed off the served scope", () => {
  test("nearby names no city; regional names the served country", () => {
    expect(
      discoverySubtitleFor({
        lang: "en",
        regionName: "Hanoi",
        scope: "nearby",
        supplemented: false,
      }),
    ).toBe("Dishes associated with places in your area.");
    expect(
      discoverySubtitleFor({
        lang: "en",
        regionName: "Vietnam",
        scope: "regional",
        supplemented: false,
      }),
    ).toBe("Explore Vietnam favorites and regional specialties.");
    expect(
      discoverySubtitleFor({
        lang: "vi",
        regionName: "Việt Nam",
        scope: "regional",
        supplemented: false,
      }),
    ).toBe("Khám phá món yêu thích và đặc sản của Việt Nam.");
  });

  test("supplemented names the country across which the pool was broadened", () => {
    const subtitle = discoverySubtitleFor({
      lang: "en",
      regionName: "Vietnam",
      scope: "regional",
      supplemented: true,
    });

    expect(subtitle).toContain("Vietnam");
    expect(subtitle).not.toMatch(/near you/i);
  });

  test("regional without a name and worldwide never read as local", () => {
    expect(
      discoverySubtitleFor({
        lang: "en",
        regionName: null,
        scope: "regional",
        supplemented: false,
      }),
    ).toBe("Explore regional favorites and specialties.");
    expect(
      discoverySubtitleFor({
        lang: "en",
        regionName: "Vietnam",
        scope: "worldwide",
        supplemented: false,
      }),
    ).not.toMatch(/local favorites/i);
    expect(
      discoverySubtitleFor({
        lang: "en",
        regionName: null,
        scope: "worldwide",
        supplemented: false,
      }),
    ).toContain("elsewhere");
  });
});

describe("selector copy contract", () => {
  test("every string exists and is non-empty in English and Vietnamese", () => {
    for (const lang of ["en", "vi"] as const) {
      const copy = discoveryLocationCopyFor(lang);

      for (const key of COPY_KEYS) {
        expect(copy[key].length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }

    const actualKeys = Object.keys(discoveryLocationCopyFor("en")).toSorted().join(",");
    const expectedKeys = [...COPY_KEYS].toSorted().join(",");

    expect(actualKeys).toBe(expectedKeys);
  });

  test("no banned implementation phrase leaks into either language", () => {
    for (const lang of ["en", "vi"] as const) {
      const copy = discoveryLocationCopyFor(lang);

      for (const key of COPY_KEYS) {
        const value = copy[key];

        for (const banned of BANNED_PHRASES) {
          expect(value.includes(banned), `${lang}.${key} contains ${banned}`).toBe(false);
        }
      }
    }
  });

  test("non-Vietnamese locales fall back to English until i18n promotes the keys", () => {
    expect(discoveryLocationCopyFor("hi")).toEqual(discoveryLocationCopyFor("en"));
  });
});

describe("indicator SSR", () => {
  test("way back names the served country in human language", () => {
    expect(
      discoveryBackLabelFor({
        countries: [
          { code: "VN", label: "Vietnam" },
          { code: "TH", label: "Thailand" },
        ],
        lang: "en",
        selectedCountry: "VN",
      }),
    ).toBe("Show dishes from Vietnam");
    expect(
      discoveryBackLabelFor({
        countries: [{ code: "VN", label: "Việt Nam" }],
        lang: "vi",
        selectedCountry: "VN",
      }),
    ).toBe("Xem món từ Việt Nam");
    expect(discoveryBackLabelFor({ countries: [], lang: "en", selectedCountry: "XX" })).toBe(
      "Show regional dishes",
    );
    expect(discoveryBackLabelFor({ countries: [], lang: "en", selectedCountry: null })).toBe(
      "Show regional dishes",
    );
  });

  test("rendering never requests geolocation: only an explicit tap may", () => {
    let preciseCalls = 0;
    let worldwideCalls = 0;
    let countryCalls = 0;
    let backCalls = 0;

    renderToStaticMarkup(
      createElement(
        DiscoveryLocation,
        baseProps({
          onBackToRegion: () => {
            backCalls += 1;
          },
          onChooseCountry: () => {
            countryCalls += 1;
          },
          onExploreWorldwide: () => {
            worldwideCalls += 1;
          },
          onUsePrecise: () => {
            preciseCalls += 1;
          },
          showBackToRegion: true,
        }),
      ),
    );

    expect(preciseCalls).toBe(0);
    expect(worldwideCalls).toBe(0);
    expect(countryCalls).toBe(0);
    expect(backCalls).toBe(0);
  });

  test("trigger shows the compact indicator with the change affordance", () => {
    const html = renderToStaticMarkup(createElement(DiscoveryLocation, baseProps()));

    expect(html).toContain("Vietnam");
    expect(html).toContain("Change location");
    expect(html).toContain("min-h-11");
  });

  test("locating shows the spinner note; denial keeps content with a status note", () => {
    const locating = renderToStaticMarkup(
      createElement(DiscoveryLocation, baseProps({ locating: true })),
    );

    expect(locating).toContain("Finding your area…");

    const denied = renderToStaticMarkup(
      createElement(DiscoveryLocation, baseProps({ preciseDenied: true })),
    );

    expect(denied).toContain("keeping regional dishes");
    expect(denied).toContain("<output");
  });

  test("denial note never appears while locating", () => {
    const html = renderToStaticMarkup(
      createElement(DiscoveryLocation, baseProps({ locating: true, preciseDenied: true })),
    );

    expect(html).not.toContain("keeping regional dishes");
  });

  test("rendered markup carries no banned phrases or coordinate leaks", () => {
    const html = renderToStaticMarkup(
      createElement(
        DiscoveryLocation,
        baseProps({ lang: "vi", locating: true, preciseDisabled: true }),
      ),
    );

    for (const banned of BANNED_PHRASES) {
      expect(html.includes(banned), `markup contains ${banned}`).toBe(false);
    }

    expect(html).not.toMatch(/latitude/i);
    expect(html).not.toMatch(/longitude/i);
  });
});
