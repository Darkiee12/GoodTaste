import {
  AXIAL_TILT_RADIANS,
  Latitude,
  Longitude,
  decodeLandGrid,
  isLandCell,
  spinForLongitude,
} from "@/components/home/globe/geo-utils";

/**
 * Stage B of the globe reveal: a geographically accurate static Earth painted
 * onto a 2D canvas, using the same bundled land mask as the WebGL globe
 * (Natural Earth raster in land-grid.ts) with the inverse of the scene's
 * transform (Rx(axial tilt) -> Ry(opening spin)), so the preview opens on the
 * same Southeast Asia view (105.85E) as the real globe.
 *
 * Deliberately avoids three.js and earth-texture.ts: this module's lazy chunk
 * is only the ~87KB base64 mask plus small math, versus a full WebGL import.
 * Ocean/land hues match earth-texture.ts exactly; spherical depth comes from
 * the .fallback-planet CSS inset shadow, not baked shading, so the disc edge
 * meets the planet circle seamlessly. Pixels outside the disc stay
 * transparent so the CSS ocean sphere shows through (Stage A).
 */

const PREVIEW_SIZE = 512;

/** Must match OPENING_LONGITUDE in use-globe-assets.ts. */
const OPENING_LONGITUDE_DEGREES = 105.8542;

const OCEAN_TOP: [number, number, number] = [74, 155, 232];
const OCEAN_BOTTOM: [number, number, number] = [28, 86, 184];
const LAND: [number, number, number] = [123, 199, 77];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Paint the orthographic opening view into `canvas`, resizing it as needed. */
export function renderStaticPreview(canvas: HTMLCanvasElement, size = PREVIEW_SIZE): void {
  const dimension = Math.min(1024, Math.max(128, Math.floor(size)));

  if (canvas.width !== dimension || canvas.height !== dimension) {
    canvas.width = dimension;
    canvas.height = dimension;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const grid = decodeLandGrid();
  const spin = spinForLongitude(Longitude(OPENING_LONGITUDE_DEGREES));

  // Inverse scene transform: world = Rx(tilt) * Ry(spin) * geo, so
  // geo = Ry(-spin) * Rx(-tilt) * world.
  const cosTilt = Math.cos(-AXIAL_TILT_RADIANS);
  const sinTilt = Math.sin(-AXIAL_TILT_RADIANS);
  const cosSpin = Math.cos(-spin);
  const sinSpin = Math.sin(-spin);

  const image = context.createImageData(dimension, dimension);

  for (let py = 0; py < dimension; py += 1) {
    const ny = 1 - ((py + 0.5) / dimension) * 2;
    const blend = py / (dimension - 1);
    const oceanR = OCEAN_TOP[0] + (OCEAN_BOTTOM[0] - OCEAN_TOP[0]) * blend;
    const oceanG = OCEAN_TOP[1] + (OCEAN_BOTTOM[1] - OCEAN_TOP[1]) * blend;
    const oceanB = OCEAN_TOP[2] + (OCEAN_BOTTOM[2] - OCEAN_TOP[2]) * blend;

    for (let px = 0; px < dimension; px += 1) {
      const nx = ((px + 0.5) / dimension) * 2 - 1;
      const offset = (py * dimension + px) * 4;

      if (nx * nx + ny * ny > 1) {
        image.data[offset + 3] = 0;
        continue;
      }

      const nz = Math.sqrt(1 - nx * nx - ny * ny);
      const y1 = ny * cosTilt - nz * sinTilt;
      const z1 = ny * sinTilt + nz * cosTilt;
      const x2 = nx * cosSpin + z1 * sinSpin;
      const z2 = -nx * sinSpin + z1 * cosSpin;

      // Inverse of latLonToVec3: u = atan2(z, -x) / 2PI, lon = u * 360 - 180.
      const latitude = 90 - (Math.acos(clampUnit(y1)) * 180) / Math.PI;
      const wrapped = Math.atan2(z2, -x2) / (Math.PI * 2);
      const longitude = (wrapped - Math.floor(wrapped)) * 360 - 180;

      const land = isLandCell(grid, Longitude(longitude), Latitude(latitude));

      image.data[offset] = land ? LAND[0] : oceanR;
      image.data[offset + 1] = land ? LAND[1] : oceanG;
      image.data[offset + 2] = land ? LAND[2] : oceanB;
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
}
