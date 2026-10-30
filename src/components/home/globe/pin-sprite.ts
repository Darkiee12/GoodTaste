import * as THREE from "three";

/** Square canvas backing the pin sprite; power-of-two keeps mipmaps cheap. */
const PIN_CANVAS_SIZE = 64;

/** Warm light pin body that reads on both blue ocean and green land. */
const PIN_FILL = "#fff3d0";

/** Dark outline + hole so the pin silhouette survives bright texels. */
const PIN_OUTLINE = "#4a2c14";
const PIN_HOLE = "#1c2b4a";

/**
 * Procedural map-pin sprite for the globe dish layer: a teardrop with a
 * punched hole, drawn once on a 2D canvas and used as the PointsMaterial
 * map. No image assets, no per-frame cost. Client-only (needs document).
 */
export function createPinTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = PIN_CANVAS_SIZE;
  canvas.height = PIN_CANVAS_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2d canvas unavailable for globe pin sprite");
  }

  const centerX = PIN_CANVAS_SIZE / 2;
  const bulbY = 24;
  const bulbRadius = 17;
  const tipY = 58;

  // Teardrop silhouette: round bulb over a tapered tail ending in a point.
  context.beginPath();
  context.moveTo(centerX, tipY);
  context.quadraticCurveTo(12, 42, centerX - bulbRadius, bulbY);
  context.arc(centerX, bulbY, bulbRadius, Math.PI, 0);
  context.quadraticCurveTo(52, 42, centerX, tipY);
  context.closePath();
  context.fillStyle = PIN_FILL;
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = PIN_OUTLINE;
  context.lineJoin = "round";
  context.stroke();

  // Punched hole in the bulb: dark disc with a thin light inner ring so it
  // reads as a hole rather than a blob at small point sizes.
  context.beginPath();
  context.arc(centerX, bulbY, 6.5, 0, Math.PI * 2);
  context.fillStyle = PIN_HOLE;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = PIN_FILL;
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}
