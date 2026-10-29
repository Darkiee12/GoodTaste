import * as THREE from "three";

import { decodeBorderGrid, decodeLandGrid } from "@/components/home/globe/geo-utils";
import { LAND_GRID_HEIGHT, LAND_GRID_WIDTH } from "@/components/home/globe/land-grid";

const TEXTURE_WIDTH = 2880;
const TEXTURE_HEIGHT = 1440;
const TEXTURE_SCALE = TEXTURE_WIDTH / LAND_GRID_WIDTH;

const OCEAN_TOP: [number, number, number] = [74, 155, 232];
const OCEAN_BOTTOM: [number, number, number] = [28, 86, 184];
const LAND: [number, number, number] = [123, 199, 77];

/** Hairline country borders: dark muted navy, drawn as short dashes. */
export const BORDER_STROKE = "rgba(23, 42, 84, 0.55)";
export const BORDER_LINE_WIDTH = 1;
export const BORDER_DASH: ReadonlyArray<number> = [5, 4];

/** One traced boundary path through border-cell centers, in grid cells. */
export type BorderPath = ReadonlyArray<{ readonly x: number; readonly y: number }>;

/** A border-cell center mapped to full-resolution texture pixels. */
type TexturePoint = { readonly px: number; readonly py: number };

/**
 * Chain adjacent border cells into continuous paths so Canvas2D dashes
 * render as coherent boundary strokes. Stroking thousands of disjoint
 * 1-cell segments instead would restart the dash phase per segment and
 * produce a dotted grid. Each cell is visited once; branches start new
 * paths where they meet. No wrap-around: x = 0 and x = width - 1 are not
 * neighbors, so no segment crosses the antimeridian seam.
 */
export function traceBorderPaths(
  borders: Uint8Array,
  width: number,
  height: number,
): Array<BorderPath> {
  const visited = new Uint8Array(width * height);
  const paths: Array<BorderPath> = [];

  const isBorder = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && borders[y * width + x] === 1;

  const unvisitedNeighbor = (x: number, y: number): { x: number; y: number } | null => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }

        if (isBorder(x + dx, y + dy) && visited[(y + dy) * width + (x + dx)] !== 1) {
          return { x: x + dx, y: y + dy };
        }
      }
    }

    return null;
  };

  const walk = (start: { x: number; y: number }): Array<{ x: number; y: number }> => {
    const chain: Array<{ x: number; y: number }> = [start];
    visited[start.y * width + start.x] = 1;
    let current = start;

    for (;;) {
      const next = unvisitedNeighbor(current.x, current.y);

      if (next === null) {
        return chain;
      }

      visited[next.y * width + next.x] = 1;
      chain.push(next);
      current = next;
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isBorder(x, y) || visited[y * width + x] === 1) {
        continue;
      }

      // Walk both directions from the seed so lines started mid-boundary
      // extend into full paths instead of half segments. Forward cells stay
      // marked, so the backward walk only explores the other direction.
      const start = { x, y };
      const forward = walk(start);
      const backward: Array<{ x: number; y: number }> = [start];
      let current = start;

      for (;;) {
        const next = unvisitedNeighbor(current.x, current.y);

        if (next === null) {
          break;
        }

        visited[next.y * width + next.x] = 1;
        backward.push(next);
        current = next;
      }

      backward.reverse();
      paths.push([...backward.slice(0, -1), ...forward]);
    }
  }

  return paths;
}

/**
 * Draw hairline dashed country borders along traced boundary paths at full
 * texture resolution. Continuous paths keep the dash phase coherent;
 * segments crossing the antimeridian seam never form (see traceBorderPaths).
 */
function strokeBorders(context: CanvasRenderingContext2D, borders: Uint8Array): void {
  const scaleX = TEXTURE_SCALE;
  const scaleY = TEXTURE_HEIGHT / LAND_GRID_HEIGHT;

  const toPx = (cell: { x: number; y: number }): TexturePoint => ({
    px: cell.x * scaleX + scaleX / 2,
    py: cell.y * scaleY + scaleY / 2,
  });

  context.save();
  context.strokeStyle = BORDER_STROKE;
  context.lineWidth = BORDER_LINE_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([...BORDER_DASH]);

  for (const path of traceBorderPaths(borders, LAND_GRID_WIDTH, LAND_GRID_HEIGHT)) {
    const first = path[0];

    if (first === undefined) {
      continue;
    }

    if (path.length === 1) {
      const { px, py } = toPx(first);
      context.fillStyle = BORDER_STROKE;
      context.fillRect(
        px - BORDER_LINE_WIDTH / 2,
        py - BORDER_LINE_WIDTH / 2,
        BORDER_LINE_WIDTH,
        BORDER_LINE_WIDTH,
      );
      continue;
    }

    const start = toPx(first);
    context.beginPath();
    context.moveTo(start.px, start.py);

    for (const cell of path.slice(1)) {
      const { px, py } = toPx(cell);
      context.lineTo(px, py);
    }

    context.stroke();
  }

  context.restore();
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
