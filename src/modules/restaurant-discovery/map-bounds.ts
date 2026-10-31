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

export interface MapCenter {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
}

/** Labeled default browsing region (Vietnam). Used only when the caller
 *  supplies no explicit center and there are no points to frame. Never 0,0. */
export const DEFAULT_MAP_CENTER: MapCenter = {
  longitude: 108.2772,
  latitude: 14.0583,
  zoom: 5,
};
