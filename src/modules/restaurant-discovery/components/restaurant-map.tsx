import { Link } from "@tanstack/react-router";
import * as maplibre from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import Map, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { z } from "zod";

import { normalizedMapBounds } from "@/modules/restaurant-discovery/map-bounds";
import type { RestaurantResult } from "@/modules/restaurant-discovery/server/index";
import type { Locale } from "@/shared/i18n";

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export default function RestaurantMap({
  points,
  selected,
  onSelect,
  onBounds,
  lang,
}: {
  points: ReadonlyArray<RestaurantResult>;
  selected: string | null;
  onSelect: (id: string) => void;
  onBounds?: (bounds: MapBounds) => void;
  lang: Locale;
}) {
  const ref = useRef<MapRef>(null);
  const [failed, setFailed] = useState(false);
  const style = z.url().safeParse(import.meta.env.VITE_MAP_STYLE_URL);
  const chosen = points.find((point) => point.id === selected);
  useEffect(() => {
    if (chosen !== undefined)
      ref.current?.jumpTo({ center: [chosen.longitude, chosen.latitude], zoom: 15 });
  }, [chosen]);

  if (!style.success) {
    return (
      <div className="discovery-map-fallback" aria-live="polite">
        The map is not configured for this environment. Browse the restaurant list and use each
        address for directions.
      </div>
    );
  }

  if (failed)
    return (
      <div className="discovery-map-fallback" aria-live="polite">
        The map could not load. The restaurant list and directions remain available.
      </div>
    );
  const first = points[0];

  return (
    <div className="discovery-map" aria-label="Restaurant locations">
      <Map
        ref={ref}
        mapLib={maplibre}
        workerUrl={workerUrl}
        mapStyle={style.data}
        initialViewState={{
          longitude: first?.longitude ?? 0,
          latitude: first?.latitude ?? 0,
          zoom: first === undefined ? 1 : 12,
        }}
        cooperativeGestures
        onError={() => setFailed(true)}
        onMoveEnd={(event) => {
          if (!event.originalEvent || onBounds === undefined) return;
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
        {chosen !== undefined && (
          <Popup
            longitude={chosen.longitude}
            latitude={chosen.latitude}
            closeButton={false}
            anchor="bottom"
            offset={24}
          >
            <Link to="/restaurants/$venueId" params={{ venueId: chosen.id }} search={{ lang }}>
              {chosen.name}
            </Link>
            <p>{chosen.address}</p>
          </Popup>
        )}
      </Map>
    </div>
  );
}
