import { Brand } from "effect";
import type * as THREE from "three";

import {
  BORDER_GRID_BASE64,
  LAND_GRID_BASE64,
  LAND_GRID_CELLS_PER_DEGREE,
  LAND_GRID_HEIGHT,
  LAND_GRID_WIDTH,
} from "@/components/home/globe/land-grid";

/** Radius of the hero globe mesh in scene units. */
export const GLOBE_RADIUS = 1;

/**
 * Geographic latitude in degrees. Branded so it cannot be swapped with a
 * longitude at call sites; construct with `Latitude(21.0285)`.
 */
export type Latitude = Brand.Branded<number, "Latitude">;

export const Latitude = Brand.nominal<Latitude>();

/**
 * Geographic longitude in degrees. Branded so it cannot be swapped with a
 * latitude at call sites; construct with `Longitude(105.8542)`.
 */
export type Longitude = Brand.Branded<number, "Longitude">;

export const Longitude = Brand.nominal<Longitude>();

/** Pixel viewport size shared by the layout math and the overlay zone test. */
export type ViewportSize = {
  readonly width: number;
  readonly height: number;
};

/** Seconds for one full hero-globe revolution about the (tilted) spin axis. */
export const GLOBE_REVOLUTION_SECONDS = 75;

/**
 * View tilt of the globe group about the X axis, in radians. Negative tips
 * the north pole away from the viewer, bringing the dish band (~15-50N)
 * into the visible cap instead of the Arctic. Validated by a coverage sweep
 * over a full revolution: 11-12 of 16 dishes on desktop, all 16 on mobile.
 */
export const AXIAL_TILT_RADIANS = -0.45;

/**
 * Roll of the spin parent about the Z axis, in radians. Zero keeps the
 * classic west-to-east spin with purely horizontal drift; a nonzero value
 * leans the spin axis so surface features drift diagonally.
 */
export const SPIN_ROLL_RADIANS = 0;

/**
 * Spin direction about the (rolled) axis: +1 means rotation.y increases so
 * front-center features drift east, matching the real Earth's west-to-east
 * rotation. Flip this sign if drift heads west.
 */
export const SPIN_DIRECTION = 1;

/** Cosine threshold for treating a surface anchor as facing the camera. */
export const FACING_COSINE_THRESHOLD = 0.15;

/**
 * Maximum globe cap as a fraction of hero height. Keep in sync with the
 * 50cqh clamp in the fallback-planet CSS (styles.css).
 */
export const GLOBE_CAP_HERO_FRACTION = 0.5;

/** Mutable per-frame link between the 3D scene and the DOM food overlay. */
export type GlobeOverlayBridge = {
  activeId: string | null;
  x: number;
  y: number;
  anchored: boolean;
  paused: boolean;
  node: HTMLElement | null;
};

/** Viewport-derived globe placement shared by the camera rig and the overlay. */
export type GlobeLayout = {
  diameterPx: number;
  capPx: number;
  pixelsPerUnit: number;
  frustumHalfHeight: number;
  centerY: number;
};

/**
 * Convert latitude/longitude in degrees to a position on the globe surface.
 * Matches the THREE.SphereGeometry vertex layout exactly, so anchors sit on
 * the same texel as their equirectangular texture position: u = (lon + 180) / 360,
 * theta = (90 - lat) * PI / 180, phi = u * 2 * PI.
 */
export function latLonToVec3(
  latitude: Latitude,
  longitude: Longitude,
  radius: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const u = (longitude + 180) / 360;
  const theta = ((90 - latitude) * Math.PI) / 180;
  const phi = u * Math.PI * 2;
  const sinTheta = Math.sin(theta);

  out.set(
    -radius * Math.cos(phi) * sinTheta,
    radius * Math.cos(theta),
    radius * Math.sin(phi) * sinTheta,
  );

  return out;
}

/**
 * Y-axis spin that brings the given longitude to face +Z (the camera side).
 * The spin group starts here so the opening view centers on Southeast Asia.
 */
export function spinForLongitude(longitude: Longitude): number {
  const phi = ((longitude + 180) / 360) * Math.PI * 2;
  const x = -Math.cos(phi);
  const z = Math.sin(phi);

  return -Math.atan2(x, z);
}

/**
 * Cosine between the globe surface normal and the view direction. Returns -1
 * for degenerate inputs. Allocates nothing for the render loop.
 */
export function facingCosine(
  surfacePoint: THREE.Vector3,
  globeCenter: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): number {
  const normalX = surfacePoint.x - globeCenter.x;
  const normalY = surfacePoint.y - globeCenter.y;
  const normalZ = surfacePoint.z - globeCenter.z;
  const normalLength = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);

  if (normalLength === 0) {
    return -1;
  }

  const viewX = cameraPosition.x - surfacePoint.x;
  const viewY = cameraPosition.y - surfacePoint.y;
  const viewZ = cameraPosition.z - surfacePoint.z;
  const viewLength = Math.sqrt(viewX * viewX + viewY * viewY + viewZ * viewZ);

  if (viewLength === 0) {
    return -1;
  }

  return (normalX * viewX + normalY * viewY + normalZ * viewZ) / (normalLength * viewLength);
}

/** True when a globe surface point faces the camera instead of hiding behind the planet. */
export function isFacingCamera(
  surfacePoint: THREE.Vector3,
  globeCenter: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  minCosine: number = FACING_COSINE_THRESHOLD,
): boolean {
  return facingCosine(surfacePoint, globeCenter, cameraPosition) > minCosine;
}

/**
 * Place the globe so only its upper cap shows: ~70% of the projected diameter
 * on narrow screens, ~32% on desktop. The full sphere still exists in 3D with
 * its center below the hero's lower edge. The cap never exceeds 50% of the
 * hero height so short landscape screens keep room for the hero copy.
 *
 * The sphere is full-bleed on mobile (104% of the hero width, so rounding
 * never leaves edge gaps) and huge on desktop: a 90%-of-width radius
 * (180% diameter), still bounded by the hero height on very wide screens.
 * The tall mobile cap plus the negative axial tilt put all 16 dishes in
 * view over a revolution; desktop shows 11 (southern dishes stay in the
 * discovery section below).
 */
export function computeGlobeLayout(viewport: ViewportSize): GlobeLayout {
  const narrow = viewport.width < 768;
  const capFraction = narrow ? 0.7 : 0.32;

  const diameterPx = narrow
    ? viewport.width * 1.04
    : Math.min(viewport.width * 1.8, viewport.height * 3.2);

  const capPx = Math.min(diameterPx * capFraction, viewport.height * GLOBE_CAP_HERO_FRACTION);
  const pixelsPerUnit = diameterPx / (GLOBE_RADIUS * 2);
  const frustumHalfHeight = viewport.height / pixelsPerUnit / 2;
  const centerY = -frustumHalfHeight + capPx / pixelsPerUnit - GLOBE_RADIUS;

  return { diameterPx, capPx, pixelsPerUnit, frustumHalfHeight, centerY };
}

/** World-space angular velocity vector in radians per second. */
export type SpinAngularVelocity = {
  x: number;
  y: number;
  z: number;
};

/** Screen-plane drift velocity of a globe surface point. */
export type SurfaceDriftVelocity = {
  x: number;
  y: number;
};

/**
 * World-space angular velocity (radians/second) of the tilted globe spin.
 * Mirrors the scene hierarchy: tilt group Rx(AXIAL_TILT) -> roll group
 * Rz(SPIN_ROLL) -> spin group rotating about local +Y at
 * SPIN_DIRECTION * 2PI / GLOBE_REVOLUTION_SECONDS.
 */
export function tiltedSpinAngularVelocity(): SpinAngularVelocity {
  const rate = (SPIN_DIRECTION * Math.PI * 2) / GLOBE_REVOLUTION_SECONDS;
  const sinRoll = Math.sin(SPIN_ROLL_RADIANS);
  const cosRoll = Math.cos(SPIN_ROLL_RADIANS);
  const rollX = -sinRoll * rate;
  const rollY = cosRoll * rate;
  const cosAxial = Math.cos(AXIAL_TILT_RADIANS);
  const sinAxial = Math.sin(AXIAL_TILT_RADIANS);

  return { x: rollX, y: rollY * cosAxial, z: rollY * sinAxial };
}

/**
 * Instantaneous screen-plane drift velocity of the front-center surface
 * point r = (0, 0, R) under the spin: v = omega x r. The orthographic
 * camera looks down -Z, so +x is screen-right (east) and +y is screen-up
 * (north). West-to-east drift means x > 0, y = 0.
 */
export function frontCenterDriftVelocity(): SurfaceDriftVelocity {
  const omega = tiltedSpinAngularVelocity();

  return { x: omega.y * GLOBE_RADIUS, y: -omega.x * GLOBE_RADIUS };
}

/** Decode a bundled MSB-first base64 bitmask into row-major cells. */
function decodeBitGrid(base64: string): Uint8Array {
  const binary = atob(base64);
  const grid = new Uint8Array(LAND_GRID_WIDTH * LAND_GRID_HEIGHT);

  for (let index = 0; index < grid.length; index += 1) {
    const byte = binary.charCodeAt(Math.floor(index / 8));

    grid[index] = (byte >> (7 - (index % 8))) & 1;
  }

  return grid;
}

/** Decode the bundled base64 land mask into row-major cells (1 = land). */
export function decodeLandGrid(): Uint8Array {
  return decodeBitGrid(LAND_GRID_BASE64);
}

/** Decode the bundled base64 land-border mask into row-major cells (1 = border). */
export function decodeBorderGrid(): Uint8Array {
  return decodeBitGrid(BORDER_GRID_BASE64);
}

/** True when the geographic coordinate falls on a land cell of the mask. */
export function isLandCell(grid: Uint8Array, longitude: Longitude, latitude: Latitude): boolean {
  const rawX = Math.floor((longitude + 180) * LAND_GRID_CELLS_PER_DEGREE);
  const rawY = Math.floor((90 - latitude) * LAND_GRID_CELLS_PER_DEGREE);
  const x = Math.min(Math.max(rawX, 0), LAND_GRID_WIDTH - 1);
  const y = Math.min(Math.max(rawY, 0), LAND_GRID_HEIGHT - 1);

  return grid[y * LAND_GRID_WIDTH + x] === 1;
}
