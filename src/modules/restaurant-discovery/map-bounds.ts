/** MapLibre can report wrapped world coordinates; HTTP bounds use normalized longitudes. */
export function normalizedMapBounds(west: number, south: number, east: number, north: number) {
  if (east - west >= 360)
    return { west: -180, south: Math.max(-90, south), east: 180, north: Math.min(90, north) };

  return {
    west: ((((west + 180) % 360) + 360) % 360) - 180,
    south: Math.max(-90, south),
    east: ((((east + 180) % 360) + 360) % 360) - 180,
    north: Math.min(90, north),
  };
}
