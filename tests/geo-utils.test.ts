import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import {
  BORDER_DASH,
  BORDER_LINE_WIDTH,
  BORDER_STROKE,
  traceBorderPaths,
} from "@/components/home/globe/earth-texture";
import { $match, FOOD_LOCATIONS, type FoodCategory } from "@/components/home/globe/food-locations";
import {
  GLOBE_RADIUS,
  GLOBE_REVOLUTION_SECONDS,
  Latitude,
  Longitude,
  VISIBLE_VERTICAL_FRACTION,
  computeGlobeLayout,
  decodeBorderGrid,
  decodeLandGrid,
  frontCenterDriftVelocity,
  isFacingCamera,
  isLandCell,
  latLonToVec3,
  spinForLongitude,
  tiltedSpinAngularVelocity,
} from "@/components/home/globe/geo-utils";
import { locales } from "@/shared/i18n";

const RADIUS = 1;

function locate(latitude: number, longitude: number): THREE.Vector3 {
  return latLonToVec3(Latitude(latitude), Longitude(longitude), RADIUS, new THREE.Vector3());
}

function rotateY(point: THREE.Vector3, angle: number): THREE.Vector3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return new THREE.Vector3(point.x * cos + point.z * sin, point.y, -point.x * sin + point.z * cos);
}

function readCategoryTag(category: FoodCategory): string {
  return $match(category, {
    LocalFavorites: () => "LocalFavorites",
    StreetFood: () => "StreetFood",
    ComfortingBowls: () => "ComfortingBowls",
    WorthTravelling: () => "WorthTravelling",
  });
}

describe("latLonToVec3", () => {
  test("maps the north pole to +Y and the south pole to -Y", () => {
    const north = locate(90, 0);
    const south = locate(-90, 0);

    expect(north.x).toBeCloseTo(0, 5);
    expect(north.y).toBeCloseTo(RADIUS, 5);
    expect(north.z).toBeCloseTo(0, 5);
    expect(south.x).toBeCloseTo(0, 5);
    expect(south.y).toBeCloseTo(RADIUS * -1, 5);
    expect(south.z).toBeCloseTo(0, 5);
  });

  test("maps equator longitude 0 to +X and 90E to -Z", () => {
    const prime = locate(0, 0);
    const east = locate(0, 90);

    expect(prime.x).toBeCloseTo(RADIUS, 5);
    expect(prime.y).toBeCloseTo(0, 5);
    expect(prime.z).toBeCloseTo(0, 5);
    expect(east.x).toBeCloseTo(0, 5);
    expect(east.y).toBeCloseTo(0, 5);
    expect(east.z).toBeCloseTo(RADIUS * -1, 5);
  });

  test("keeps every curated dish on the globe surface in the right hemisphere", () => {
    for (const dish of FOOD_LOCATIONS) {
      const point = locate(dish.latitude, dish.longitude);

      expect(point.length()).toBeCloseTo(RADIUS, 5);

      if (dish.latitude > 0) {
        expect(point.y).toBeGreaterThan(0);
      }

      if (dish.latitude < 0) {
        expect(point.y).toBeLessThan(0);
      }
    }
  });

  test("maps antipodal points to opposite vectors", () => {
    const hanoi = locate(21.0285, 105.8542);
    const antipode = locate(-21.0285, 105.8542 - 180);

    expect(hanoi.dot(antipode)).toBeCloseTo(RADIUS * RADIUS * -1, 5);
  });
});

describe("spinForLongitude", () => {
  test("brings each dish to face +Z with no sideways offset", () => {
    for (const dish of FOOD_LOCATIONS) {
      const rotated = rotateY(
        locate(dish.latitude, dish.longitude),
        spinForLongitude(dish.longitude),
      );

      const expectedZ = Math.cos((dish.latitude * Math.PI) / 180) * RADIUS;

      expect(rotated.x).toBeCloseTo(0, 5);
      expect(rotated.z).toBeCloseTo(expectedZ, 5);
    }
  });
});

describe("isFacingCamera", () => {
  const globeCenter = new THREE.Vector3(0, -1.9, 0);
  const camera = new THREE.Vector3(0, 0, 10);

  test("accepts a front-cap anchor", () => {
    const hanoi = rotateY(locate(21.0285, 105.8542), spinForLongitude(Longitude(105.8542)));
    const world = new THREE.Vector3(hanoi.x, hanoi.y + globeCenter.y, hanoi.z);

    expect(isFacingCamera(world, globeCenter, camera)).toBe(true);
  });

  test("rejects an anchor hidden behind the globe", () => {
    const hanoi = rotateY(
      locate(21.0285, 105.8542),
      spinForLongitude(Longitude(105.8542)) + Math.PI,
    );

    const world = new THREE.Vector3(hanoi.x, hanoi.y + globeCenter.y, hanoi.z);

    expect(isFacingCamera(world, globeCenter, camera)).toBe(false);
  });

  test("rejects anchors near the far limb", () => {
    const world = new THREE.Vector3(0.99, globeCenter.y, -0.1);

    expect(isFacingCamera(world, globeCenter, camera)).toBe(false);
  });
});

function isCoastal(grid: Uint8Array, longitude: number, latitude: number): boolean {
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLon = -1; dLon <= 1; dLon += 1) {
      if (isLandCell(grid, Longitude(longitude + dLon), Latitude(latitude + dLat))) {
        return true;
      }
    }
  }

  return false;
}

describe("land grid", () => {
  test("recognizes continental cities, coastal neighborhoods and mid-ocean cells", () => {
    const grid = decodeLandGrid();

    expect(grid.length).toBe(720 * 360);

    // The coarse land mask omits small islands, so it cannot validate every
    // real city in the expanded worldwide catalog.
    for (const [longitude, latitude] of [
      [105.8542, 21.0285],
      [13.405, 52.52],
      [77.209, 28.614],
    ] as const) {
      expect(isLandCell(grid, Longitude(longitude), Latitude(latitude))).toBe(true);
    }

    for (const [longitude, latitude] of [
      [14.2681, 40.8518],
      [-77.0428, -12.0464],
      [-0.3763, 39.4699],
    ] as const) {
      expect(isCoastal(grid, longitude, latitude)).toBe(true);
    }

    expect(isLandCell(grid, Longitude(-150), Latitude(0))).toBe(false);
    expect(isLandCell(grid, Longitude(-30), Latitude(0))).toBe(false);
    expect(isLandCell(grid, Longitude(80), Latitude(-30))).toBe(false);
  });
});

function hasBorderNear(grid: Uint8Array, longitude: number, latitude: number): boolean {
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLon = -1; dLon <= 1; dLon += 1) {
      if (isLandCell(grid, Longitude(longitude + dLon), Latitude(latitude + dLat))) {
        return true;
      }
    }
  }

  return false;
}

describe("border grid", () => {
  test("marks known land borders and leaves interiors, lone islands, and sea clear", () => {
    const borders = decodeBorderGrid();

    expect(borders.length).toBe(720 * 360);

    const crossings: Array<[number, number]> = [
      [7.0, 48.7], // France/Germany
      [-110.0, 49.0], // US/Canada 49th parallel
      [-53.5, -27.0], // Brazil/Argentina
      [79.0, 34.5], // India/China
      [1.5, 42.5], // Spain/France Pyrenees
    ];

    for (const [longitude, latitude] of crossings) {
      expect(hasBorderNear(borders, longitude, latitude)).toBe(true);
    }

    const clear: Array<[number, number]> = [
      [-52.0, -10.0], // central Brazil interior
      [-42.0, 74.0], // Greenland has no internal borders
      [-150.0, 0.0], // mid Pacific ocean
      [2.0, 24.0], // central Sahara Algeria interior
    ];

    for (const [longitude, latitude] of clear) {
      expect(hasBorderNear(borders, longitude, latitude)).toBe(false);
    }
  });

  test("keeps every border cell on land", () => {
    const borders = decodeBorderGrid();
    const land = decodeLandGrid();
    let count = 0;

    for (let index = 0; index < borders.length; index += 1) {
      if (borders[index] === 1) {
        count += 1;
        expect(land[index]).toBe(1);
      }
    }

    expect(count).toBeGreaterThan(1000);
  });
});

/** Shared framing invariants: full circle in frame horizontally, ~80% visible vertically. */
function expectPlanetFraming(width: number, height: number): void {
  const layout = computeGlobeLayout({ width, height });
  const centerXPx = layout.centerX * layout.pixelsPerUnit + width / 2;
  const centerYPx = height / 2 - layout.centerY * layout.pixelsPerUnit;
  const radiusPx = layout.diameterPx / 2;
  const leftEdge = centerXPx - radiusPx;
  const rightEdge = centerXPx + radiusPx;
  const topEdge = centerYPx - radiusPx;
  const bottomEdge = centerYPx + radiusPx;
  const visibleVertical = height - topEdge;

  expect(layout.diameterPx).toBeGreaterThan(0);
  expect(leftEdge).toBeGreaterThanOrEqual(-0.5);
  expect(rightEdge).toBeLessThanOrEqual(width + 0.5);
  expect(topEdge).toBeGreaterThanOrEqual(-0.5);
  expect(visibleVertical / layout.diameterPx).toBeCloseTo(0.8, 2);
  expect(bottomEdge).toBeGreaterThan(height);
  expect(layout.capPx).toBeCloseTo(layout.diameterPx * 0.8, 5);
}

describe("computeGlobeLayout", () => {
  test("frames the planet at the user screenshot size 1874x818", () => {
    expectPlanetFraming(1874, 818);

    const layout = computeGlobeLayout({ width: 1874, height: 818 });

    expect(layout.diameterPx).toBeCloseTo(818 / 0.8, 1);
  });

  test("frames the planet at 1920x1080", () => {
    expectPlanetFraming(1920, 1080);
  });

  test("frames the planet at 1440x900", () => {
    expectPlanetFraming(1440, 900);
  });

  test("frames the planet at 1280x800", () => {
    expectPlanetFraming(1280, 800);
  });

  test("frames the planet at 1024x768", () => {
    expectPlanetFraming(1024, 768);
  });

  test("frames the planet at tablet portrait 768x1024", () => {
    expectPlanetFraming(768, 1024);
  });

  test("frames the planet at mobile portrait 390x844", () => {
    expectPlanetFraming(390, 844);

    const layout = computeGlobeLayout({ width: 390, height: 844 });
    const centerXPx = layout.centerX * layout.pixelsPerUnit + 390 / 2;

    // Narrow heroes converge back to a centered globe.
    expect(centerXPx).toBeCloseTo(390 / 2, 5);
  });

  test("frames the planet at mobile portrait 375x667", () => {
    expectPlanetFraming(375, 667);
  });

  test("frames the planet at short landscape 667x375", () => {
    expectPlanetFraming(667, 375);
  });

  test("frames the planet at ultrawide 3440x1440", () => {
    expectPlanetFraming(3440, 1440);
  });

  test("anchors desktop globes right with open universe left", () => {
    const layout = computeGlobeLayout({ width: 1874, height: 818 });
    const centerXPx = layout.centerX * layout.pixelsPerUnit + 1874 / 2;

    expect(centerXPx).toBeGreaterThan(1874 / 2);
    expect(centerXPx - layout.diameterPx / 2).toBeGreaterThanOrEqual(0);
  });

  test("keeps the globe radius consistent with the scene constant", () => {
    expect(GLOBE_RADIUS).toBe(1);
  });

  test("keeps the vertical framing fraction at 80%", () => {
    expect(VISIBLE_VERTICAL_FRACTION).toBe(0.8);
  });
});

describe("country border rendering", () => {
  test("paints hairline dashed borders, never heavy black strokes", () => {
    expect(BORDER_LINE_WIDTH).toBeLessThanOrEqual(1);
    expect(BORDER_DASH.length).toBeGreaterThanOrEqual(2);

    for (const dash of BORDER_DASH) {
      expect(dash).toBeGreaterThan(0);
    }

    expect(BORDER_STROKE).toMatch(/rgba\(.+,\s*0\.\d+\)$/);
  });

  test("chains adjacent border cells into continuous paths", () => {
    const width = 5;
    const height = 5;
    const borders = new Uint8Array(width * height);

    borders[2 * width + 1] = 1;
    borders[2 * width + 2] = 1;
    borders[2 * width + 3] = 1;

    const paths = traceBorderPaths(borders, width, height);

    expect(paths).toHaveLength(1);

    const cells = new Set(paths[0]?.map((cell) => cell.y * width + cell.x));

    expect(cells).toEqual(new Set([2 * width + 1, 2 * width + 2, 2 * width + 3]));
  });

  test("never joins cells across the antimeridian seam", () => {
    const width = 5;
    const height = 3;
    const borders = new Uint8Array(width * height);

    borders[1 * width + 0] = 1;
    borders[1 * width + 4] = 1;

    const paths = traceBorderPaths(borders, width, height);

    expect(paths).toHaveLength(2);
  });

  test("covers every real border cell exactly once", () => {
    const borders = decodeBorderGrid();
    const seen = new Set<number>();
    let total = 0;

    for (const path of traceBorderPaths(borders, 720, 360)) {
      expect(path.length).toBeGreaterThan(0);

      for (const cell of path) {
        const index = cell.y * 720 + cell.x;

        expect(seen.has(index)).toBe(false);
        seen.add(index);
        total += 1;
      }
    }

    let borderCount = 0;

    for (const cell of borders) {
      if (cell === 1) {
        borderCount += 1;
      }
    }

    expect(total).toBe(borderCount);
    expect(total).toBeGreaterThan(1000);
  });
});

describe("west-to-east spin drift", () => {
  test("drifts the front-center surface point east with no northward component", () => {
    const drift = frontCenterDriftVelocity();

    expect(drift.x).toBeGreaterThan(0);
    expect(drift.y).toBeCloseTo(0, 10);
  });

  test("drifts purely horizontally, not diagonally or vertically", () => {
    const drift = frontCenterDriftVelocity();
    const slope = Math.abs(drift.y / drift.x);

    expect(slope).toBeCloseTo(0, 10);
  });

  test("keeps one revolution per 75 seconds about the spin axis", () => {
    const omega = tiltedSpinAngularVelocity();
    const magnitude = Math.sqrt(omega.x * omega.x + omega.y * omega.y + omega.z * omega.z);

    expect((Math.PI * 2) / magnitude).toBeCloseTo(GLOBE_REVOLUTION_SECONDS, 5);
  });
});

describe("food locations", () => {
  test("provides five anchors per country across the worldwide catalog", () => {
    const countryCounts = new Map<string, number>();

    for (const location of FOOD_LOCATIONS) {
      const country = location.country.get("en");

      if (country === undefined) throw new Error("Country name is missing");
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    expect(countryCounts.size).toBeGreaterThanOrEqual(190);

    for (const count of countryCounts.values()) expect(count).toBe(5);
  });

  test("keeps anchor ids distinct across all cities", () => {
    const ids = new Set(FOOD_LOCATIONS.map((dish) => dish.id));

    expect(ids.size).toBe(FOOD_LOCATIONS.length);
  });

  test("fills country, region, and description in every locale for every dish", () => {
    for (const dish of FOOD_LOCATIONS) {
      for (const locale of locales) {
        expect(dish.country.get(locale)).toBeDefined();
        expect(dish.region.get(locale)).toBeDefined();
        expect(dish.description.get(locale)).toBeDefined();
      }

      expect(dish.country.size).toBe(locales.length);
      expect(dish.region.size).toBe(locales.length);
      expect(dish.description.size).toBe(locales.length);
    }
  });

  test("gives every anchor an emoji and at least one category", () => {
    for (const dish of FOOD_LOCATIONS) {
      expect(dish.emoji.length).toBeGreaterThan(0);
      expect(dish.categories.length).toBeGreaterThan(0);

      for (const category of dish.categories) {
        expect(["LocalFavorites", "StreetFood", "ComfortingBowls", "WorthTravelling"]).toContain(
          readCategoryTag(category),
        );
      }
    }
  });
});
