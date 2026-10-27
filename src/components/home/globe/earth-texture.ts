import * as THREE from "three";

import { decodeBorderGrid, decodeLandGrid } from "@/components/home/globe/geo-utils";
import { LAND_GRID_HEIGHT, LAND_GRID_WIDTH } from "@/components/home/globe/land-grid";

const TEXTURE_WIDTH = 2880;
const TEXTURE_HEIGHT = 1440;
const TEXTURE_SCALE = TEXTURE_WIDTH / LAND_GRID_WIDTH;

const OCEAN_TOP: [number, number, number] = [74, 155, 232];
const OCEAN_BOTTOM: [number, number, number] = [28, 86, 184];
const LAND: [number, number, number] = [123, 199, 77];
const BORDER_STROKE = "#000000";
const BORDER_LINE_WIDTH = 2;

/**
 * Draw thin black country borders as 1px segments joining adjacent border
 * cells at full texture resolution. Segments crossing the antimeridian seam
 * are skipped (no land borders cross it).
 */
function strokeBorders(context: CanvasRenderingContext2D, borders: Uint8Array): void {
  const scaleX = TEXTURE_SCALE;
  const scaleY = TEXTURE_HEIGHT / LAND_GRID_HEIGHT;

  const neighbors: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 1],
  ];

  context.save();
  context.strokeStyle = BORDER_STROKE;
  context.lineWidth = BORDER_LINE_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  for (let y = 0; y < LAND_GRID_HEIGHT; y += 1) {
    for (let x = 0; x < LAND_GRID_WIDTH; x += 1) {
      if (borders[y * LAND_GRID_WIDTH + x] !== 1) {
        continue;
      }

      const cx = x * scaleX + scaleX / 2;
      const cy = y * scaleY + scaleY / 2;

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || nx >= LAND_GRID_WIDTH || ny < 0 || ny >= LAND_GRID_HEIGHT) {
          continue;
        }

        if (borders[ny * LAND_GRID_WIDTH + nx] !== 1) {
          continue;
        }

        context.moveTo(cx, cy);
        context.lineTo(nx * scaleX + scaleX / 2, ny * scaleY + scaleY / 2);
      }
    }
  }

  context.stroke();

  // Single-cell borders with no border neighbor (tiny enclaves) get one dot.
  context.fillStyle = BORDER_STROKE;

  for (let y = 0; y < LAND_GRID_HEIGHT; y += 1) {
    for (let x = 0; x < LAND_GRID_WIDTH; x += 1) {
      const isIsolatedBorder =
        borders[y * LAND_GRID_WIDTH + x] === 1 && !hasBorderNeighbor(borders, x, y);

      if (!isIsolatedBorder) {
        continue;
      }

      context.fillRect(
        x * scaleX + scaleX / 2 - BORDER_LINE_WIDTH / 2,
        y * scaleY + scaleY / 2 - BORDER_LINE_WIDTH / 2,
        BORDER_LINE_WIDTH,
        BORDER_LINE_WIDTH,
      );
    }
  }

  context.restore();
}

function hasBorderNeighbor(borders: Uint8Array, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || nx >= LAND_GRID_WIDTH || ny < 0 || ny >= LAND_GRID_HEIGHT) {
        continue;
      }

      if (borders[ny * LAND_GRID_WIDTH + nx] === 1) {
        return true;
      }
    }
  }

  return false;
}

/** Build the stylized equirectangular ocean/land texture from the bundled mask. Client-only. */
export function createEarthTexture(): THREE.CanvasTexture {
  const grid = decodeLandGrid();
  const borders = decodeBorderGrid();
  const small = document.createElement("canvas");
  small.width = LAND_GRID_WIDTH;
  small.height = LAND_GRID_HEIGHT;
  const smallContext = small.getContext("2d");

  if (!smallContext) {
    throw new Error("2d canvas unavailable for globe texture");
  }

  const image = smallContext.createImageData(LAND_GRID_WIDTH, LAND_GRID_HEIGHT);

  for (let y = 0; y < LAND_GRID_HEIGHT; y += 1) {
    const blend = y / (LAND_GRID_HEIGHT - 1);
    const oceanR = Math.round(OCEAN_TOP[0] + (OCEAN_BOTTOM[0] - OCEAN_TOP[0]) * blend);
    const oceanG = Math.round(OCEAN_TOP[1] + (OCEAN_BOTTOM[1] - OCEAN_TOP[1]) * blend);
    const oceanB = Math.round(OCEAN_TOP[2] + (OCEAN_BOTTOM[2] - OCEAN_TOP[2]) * blend);

    for (let x = 0; x < LAND_GRID_WIDTH; x += 1) {
      const offset = (y * LAND_GRID_WIDTH + x) * 4;

      if (grid[y * LAND_GRID_WIDTH + x] === 1) {
        image.data[offset] = LAND[0];
        image.data[offset + 1] = LAND[1];
        image.data[offset + 2] = LAND[2];
        image.data[offset + 3] = 255;
      } else {
        image.data[offset] = oceanR;
        image.data[offset + 1] = oceanG;
        image.data[offset + 2] = oceanB;
        image.data[offset + 3] = 255;
      }
    }
  }

  smallContext.putImageData(image, 0, 0);

  const full = document.createElement("canvas");
  full.width = TEXTURE_WIDTH;
  full.height = TEXTURE_HEIGHT;
  const fullContext = full.getContext("2d");

  if (!fullContext) {
    throw new Error("2d canvas unavailable for globe texture");
  }

  fullContext.imageSmoothingEnabled = true;
  fullContext.imageSmoothingQuality = "high";
  fullContext.drawImage(small, 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  strokeBorders(fullContext, borders);

  const texture = new THREE.CanvasTexture(full);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;

  return texture;
}
