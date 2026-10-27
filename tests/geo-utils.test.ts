import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import { $match, FOOD_LOCATIONS, type FoodCategory } from "@/components/home/globe/food-locations";
import {
  GLOBE_RADIUS,
  GLOBE_REVOLUTION_SECONDS,
  Latitude,
  Longitude,
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

const COASTAL_DISH_IDS = new Set(["pizza-napoletana", "ceviche", "paella"]);

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
  test("marks curated dish cities as land and mid-ocean points as sea", () => {
    const grid = decodeLandGrid();

    expect(grid.length).toBe(720 * 360);

    for (const dish of FOOD_LOCATIONS) {
      if (COASTAL_DISH_IDS.has(dish.id)) {
        expect(isCoastal(grid, dish.longitude, dish.latitude)).toBe(true);
      } else {
        expect(isLandCell(grid, dish.longitude, dish.latitude)).toBe(true);
      }
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

describe("computeGlobeLayout", () => {
  test("is full-bleed on a narrow phone at 104% width with a 70% cap", () => {
    const layout = computeGlobeLayout({ width: 390, height: 784 });

    expect(layout.diameterPx).toBeCloseTo(390 * 1.04, 5);
    expect(layout.capPx / layout.diameterPx).toBeCloseTo(0.7, 3);
    expect(layout.diameterPx).toBeGreaterThan(390);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("spans a 90%-of-width radius on a tall desktop hero with a 32% cap", () => {
    const layout = computeGlobeLayout({ width: 1000, height: 1400 });

    expect(layout.diameterPx).toBeCloseTo(1000 * 1.8, 5);
    expect(layout.capPx / layout.diameterPx).toBeCloseTo(0.32, 3);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("gives a 90%-of-width radius on a 1920x1080 screen", () => {
    const layout = computeGlobeLayout({ width: 1920, height: 1080 });

    expect(layout.diameterPx / 2).toBeCloseTo(1920 * 0.9, 5);
    expect(layout.capPx).toBeLessThanOrEqual(1080 * 0.5);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("clamps the cap to 50% of the hero on a typical 16:9 desktop", () => {
    const layout = computeGlobeLayout({ width: 1440, height: 844 });

    expect(layout.diameterPx).toBeCloseTo(1440 * 1.8, 5);
    expect(layout.capPx).toBeCloseTo(844 * 0.5, 5);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("stays height-bounded on ultrawide desktop screens", () => {
    const layout = computeGlobeLayout({ width: 3440, height: 1440 });

    expect(layout.diameterPx).toBeCloseTo(1440 * 3.2, 5);
    expect(layout.capPx).toBeLessThanOrEqual(1440 * 0.5);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("clamps the cap on short landscape screens while staying full-bleed", () => {
    const layout = computeGlobeLayout({ width: 667, height: 311 });

    expect(layout.diameterPx).toBeCloseTo(667 * 1.04, 5);
    expect(layout.diameterPx).toBeGreaterThanOrEqual(667);
    expect(layout.capPx).toBeLessThanOrEqual(311 * 0.5);
    expect(layout.centerY).toBeLessThan(0);
  });

  test("keeps the globe radius consistent with the scene constant", () => {
    expect(GLOBE_RADIUS).toBe(1);
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
  test("ships sixteen dishes", () => {
    expect(FOOD_LOCATIONS).toHaveLength(16);
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

  test("gives every dish a distinct emoji and at least one category", () => {
    const emojis = new Set(FOOD_LOCATIONS.map((dish) => dish.emoji));

    expect(emojis.size).toBe(FOOD_LOCATIONS.length);

    for (const dish of FOOD_LOCATIONS) {
      expect(dish.categories.length).toBeGreaterThan(0);

      for (const category of dish.categories) {
        expect(["LocalFavorites", "StreetFood", "ComfortingBowls", "WorthTravelling"]).toContain(
          readCategoryTag(category),
        );
      }
    }
  });
});
