# Maps and restaurant geosearch

**Accepted scaffold stack:** **PostgreSQL 18 + PostGIS 3.6** for geospatial search; **MapLibre GL JS** via **`react-map-gl/maplibre`** for the React browser map; **MapTiler** is the initial recommended hosted vector-tile provider, subject to pricing/license review. The React map packages are **not installed yet**. No OpenSearch is needed for the MVP.

## Responsibilities

| Component | Owns |
| --- | --- |
| `restaurant-discovery/server/repository/sql/` | Reylo/PostGIS spatial SQL: nearby restaurants, bounds, distances, ordering |
| `restaurant-discovery/server/operations/` | Effect application operations, dietary/source-evidence policy |
| `restaurant-discovery/*.functions.ts` | TanStack Start server RPC, Zod 4.6 input, verified Actor, authorization |
| `restaurant-discovery/components/` | List, map, markers, viewport state, loading and empty results |
| MapLibre GL JS + `react-map-gl/maplibre` | Interactive WebGL vector map and React controls |
| Hosted tile style (MapTiler initially) | Roads, boundaries, labels and map style, **not restaurant records** |

FeastJourney's restaurant location and "serves dish" evidence live in PostgreSQL. A map tile provider is neither a source of verified menus nor a geocoding/Places replacement. Preserve provenance and serving-claim uncertainty.

## Component boundary under TanStack Start

Keep the **page, headings, list and loader data SSR-friendly**, but mount the WebGL map **client-side only**. Use TanStack Router's `ClientOnly` and lazily import the map to avoid evaluating browser/DOM code on the server. If an entire map-only route is client-rendered, TanStack Start supports `ssr: "data-only"` so loaders can still run server-side; avoid disabling SSR globally.

Proposed source placement (do not create empty placeholders):

```text
src/modules/restaurant-discovery/
  components/
    restaurant-map.tsx        # Browser-only MapLibre wrapper
    restaurant-map-panel.tsx  # ClientOnly + Suspense fallback
    restaurant-list.tsx       # SSR-friendly, accessible list
  restaurant.schema.ts        # Zod geographic search input
  restaurant.functions.ts     # Server function with actor policy
  server/
    operations/search-nearby.ts
    repository/sql/search-nearby.sql
```

When implementing the map, install `maplibre-gl` and `react-map-gl` (maintained import path: `react-map-gl/maplibre`) and import `maplibre-gl/dist/maplibre-gl.css`. `Marker`, `Popup`, `NavigationControl`, `Source` and `Layer` are available for UI; prefer GeoJSON source/layer clustering for many points, not thousands of DOM markers.

**Example:**

```tsx
// restaurant-map.tsx, client-loaded component
import Map, { NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

export default function RestaurantMap() {
  return (
    <Map
      initialViewState={{ longitude: 106.7, latitude: 10.8, zoom: 12 }}
      mapStyle={import.meta.env.VITE_MAP_STYLE_URL}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" />
    </Map>
  );
}
```

These coordinates are illustrative, **not an inferred user location**. `VITE_MAP_STYLE_URL` is a browser-visible map-style URL with a public/referrer-restricted provider key, not a secret.

```tsx
// restaurant-map-panel.tsx
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const RestaurantMap = lazy(() => import("./restaurant-map"));

export function RestaurantMapPanel() {
  return (
    <ClientOnly fallback={<div role="status">Loading map…</div>}>
      <Suspense fallback={<div role="status">Loading map…</div>}>
        <RestaurantMap />
      </Suspense>
    </ClientOnly>
  );
}
```

Test SSR/build behavior with the actual TanStack/Bun versions first; MapLibre's docs mention a Vite `ssr.noExternal` workaround for certain CommonJS/server bundles, but do not enable that workaround preemptively.

## PostGIS query and model conventions

- Preferred schema candidate: `geography(Point,4326)` for restaurant coordinates, with `GIST` index created in a reviewed Flyway migration when the actual restaurant table is designed.
- Coordinates are **longitude then latitude** for `ST_MakePoint(lon, lat)`; Zod validates bounds `[-180,180]` / `[-90,90]`, allowed radius and maximum result count at the transport boundary.
- Query uses `ST_DWithin` for index-assisted radius filtering, `ST_Distance` only for eligible candidates/ranking; `geography` distances are in meters.
- Return scalar columns (`distance_meters`, IDs, evidence, names), letting Reylo infer types from SQL. Do not expose raw geometry values without an explicit codec/format.
- Tables will live in the **`feastjourney`** PostgreSQL schema, separately from PostGIS's installed extension objects in `public`. Query tables by schema-qualified name or configure search_path intentionally.
- Stable ordering and pagination matter. Dish identity belongs to Food Discovery; venue/menu/serving evidence belongs to Restaurant Discovery. Distance alone is not proof a dish is served.

## Product and performance rules

- Keep list and map selections synchronized, with an accessible list alternative and visible provider/OSM attribution.
- Search when the map moves **and settles** (`onMoveEnd`), not continuously on `onMove`. Debounce, limit bounding-box/radius queries and cancel obsolete requests. Avoid unbounded provider/DB usage.
- Only request browser geolocation on a clear user action and with permission; map browsing must work without it. User location must not be silently leaked to a tile/geocoding provider.
- Document error/empty/loading/permission-denied and unavailable-map fallbacks, mobile scroll and gesture behavior, and tile/API cost guards.
- MapLibre is open source, but tiles are not automatically free. Do **not** use `tile.openstreetmap.org` as an unlimited production tile CDN; comply with tile provider usage, caching, attribution and license requirements.
- OpenSearch remains deferred unless complex multilingual ranking or measured query performance warrants a separate index and synchronization pipeline.

## Verification checklist before shipping UI

1. PostGIS functions and Flyway schema migration pass on a fresh DB.
2. Repository geospatial integration tests (inside/outside radius, boundary, ties, missing location, GiST index).
3. Guest/member access tests for search versus saved items.
4. TanStack Start SSR/hydration and browser-only MapLibre mount works in production build.
5. Marker/list sync, mobile gestures, stable result rendering, visible attribution and optional geolocation.
6. MapTiler/domain key restrictions, billing alerts and API throttling reviewed.

## References

- https://visgl.github.io/react-map-gl/docs
- https://maplibre.org/maplibre-gl-js/docs/
- https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr
- https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors
- https://docs.maptiler.com/maplibre/
- https://operations.osmfoundation.org/policies/tiles/
- https://postgis.net/docs/ST_DWithin.html
