import * as maplibre from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import Map, { Marker, NavigationControl } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { z } from "zod";

import {
  DEFAULT_MAP_CENTER,
  type MapCenter,
  normalizedMapBounds,
} from "@/modules/restaurant-discovery/map-bounds";
import type {
  DishRestaurantResult,
  RestaurantResult,
} from "@/modules/restaurant-discovery/server/index";
import type { Locale } from "@/shared/i18n";

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const FALLBACK_COPY_EN = {
  missing:
    "Map tiles are not configured here (VITE_MAP_STYLE_URL is unset). The list, addresses, and directions still work.",
  failed: "The map could not load. The list and directions remain available.",
  empty:
    "No restaurant locations to show yet. Pan the map or choose an area, then Search this area.",
};

function fallbackCopy(lang: Locale) {
  if (lang === "vi") {
    return {
      missing:
        "Chưa cấu hình ô bản đồ ở đây (VITE_MAP_STYLE_URL trống). Danh sách, địa chỉ và chỉ đường vẫn dùng được.",
      failed: "Không tải được bản đồ. Danh sách và chỉ đường vẫn dùng được.",
      empty:
        "Chưa có vị trí nhà hàng để hiện. Kéo bản đồ hoặc chọn khu vực, rồi Tìm trong khu vực.",
    };
  }

  return FALLBACK_COPY_EN;
}

export default function RestaurantMap({
  points,
  selected,
  onSelect,
  onBounds,
  lang,
  center,
  emptyNote,
}: {
  points: ReadonlyArray<RestaurantResult | DishRestaurantResult>;
  selected: string | null;
  onSelect: (id: string) => void;
  onBounds?: (bounds: MapBounds) => void;
  lang: Locale;
  center?: MapCenter;
  emptyNote?: string;
}) {
  const ref = useRef<MapRef>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const userMoved = useRef(false);
  const style = z.url().safeParse(import.meta.env.VITE_MAP_STYLE_URL);
  const copy = fallbackCopy(lang);
  const chosen = points.find((point) => point.id === selected);
  const fittedKey = useRef<string>("");
  const first = points[0];

  /** Explicit caller center wins; otherwise frame the first point;
   *  with no points and no center, use the labeled default region. */
  const initialCenter: MapCenter =
    center ??
    (first === undefined
      ? DEFAULT_MAP_CENTER
      : { longitude: first.longitude, latitude: first.latitude, zoom: 13 });

  useEffect(() => {
    if (chosen !== undefined) {
      ref.current?.jumpTo({ center: [chosen.longitude, chosen.latitude], zoom: 15 });
    }
  }, [chosen]);

  useEffect(() => {
    if (points.length === 0 || ref.current === null || selected !== null) return;

    if (!ready || userMoved.current) return;

    const key = points.map((point) => point.id).join("|");

    if (key === fittedKey.current) return;

    fittedKey.current = key;
    const map = ref.current.getMap();

    if (points.length === 1) {
      const only = points[0];

      if (only !== undefined) map.jumpTo({ center: [only.longitude, only.latitude], zoom: 13 });

      return;
    }

    const bounds = new maplibre.LngLatBounds();

    for (const point of points) bounds.extend([point.longitude, point.latitude]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
  }, [points, selected, ready]);

  if (!style.success) {
    return (
      <div className="discovery-map-fallback" aria-live="polite">
        {copy.missing}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="discovery-map-fallback" aria-live="polite">
        {copy.failed}
      </div>
    );
  }

  return (
    <div className="discovery-map" aria-label="Restaurant locations">
      <Map
        ref={ref}
        mapLib={maplibre}
        workerUrl={workerUrl}
        mapStyle={style.data}
        initialViewState={{
          longitude: initialCenter.longitude,
          latitude: initialCenter.latitude,
          zoom: initialCenter.zoom,
        }}
        cooperativeGestures
        attributionControl={{ compact: true }}
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
        onMoveEnd={(event) => {
          if (event.originalEvent === undefined) return;

          userMoved.current = true;

          if (onBounds === undefined) return;
          const bounds = event.target.getBounds();

          onBounds(
            normalizedMapBounds(
              bounds.getWest(),
              bounds.getSouth(),
              bounds.getEast(),
              bounds.getNorth(),
            ),
          );
        }}
      >
        <NavigationControl position="top-right" />
        {points.map((point, index) => (
          <Marker key={point.id} longitude={point.longitude} latitude={point.latitude}>
            <button
              type="button"
              className="restaurant-pin"
              aria-label={`Show ${point.name}`}
              aria-pressed={selected === point.id}
              onClick={() => onSelect(point.id)}
            >
              {index + 1}
            </button>
          </Marker>
        ))}
      </Map>
      {points.length === 0 && (
        <p className="discovery-map-empty" aria-live="polite">
          {emptyNote ?? copy.empty}
        </p>
      )}
    </div>
  );
}
