# Maps and restaurant geosearch

Restaurant Discovery uses PostgreSQL 18 + PostGIS 3.6 for geographic truth and
MapLibre GL JS 6 through `react-map-gl/maplibre` 8 for browser rendering.
The installed versions are pinned by `bun.lock`. A licensed hosted style is
configured with the browser-visible `VITE_MAP_STYLE_URL`; no default production
tile CDN or restaurant dataset is assumed.

## Server search

Venues store `geography(Point,4326)` with GiST indexes for geography distance and
geometry viewport queries. Generated non-null scalar longitude/latitude columns
derive from that geography; there is no second independently editable location.
Radius filtering uses index-aware `ST_DWithin` in meters. Viewport filtering uses
indexed geometry bounds and splits boxes crossing the antimeridian. Search
inputs validate both origin coordinates, all four bounds, radius and result cap.

Area browsing does not imply a user origin. Distance is returned only for an
explicit origin; a city's centroid is never substituted. Public venues and
source-backed dish offerings come from PostgreSQL, not tiles or inferred cuisine
matches. See [Restaurant Discovery](restaurant-discovery.md) for ranking.

## Browser boundary and interactions

`components/restaurant-map-panel.tsx` mounts the lazily imported renderer inside
TanStack `ClientOnly` and `Suspense`. Headings, result lists, menu rows and prices
remain SSR content. The renderer passes Vite's bundled MapLibre v6 worker URL
through the React wrapper's `workerUrl` option; CSS is included by the application
stylesheet. Browser globals are confined to the client renderer and user actions.

Desktop shows list and map side by side. Mobile has a list/map toggle. Marker
buttons and list actions share the selected venue ID; the popup opens the branch
detail. The list remains a keyboard-accessible alternative to map interaction.
Camera selection uses `jumpTo`, with no new animated transitions. Cooperative
gestures avoid capturing normal mobile page scrolling.

Only settled user map movements update proposed bounds. The user explicitly
chooses **Search this map area**; there are no per-frame database requests.
Wrapped world coordinates are normalized before validated navigation, preserving
antimeridian boxes. Results are capped at 50. Map failure or missing configuration
keeps the list, address and external directions available.

**Near Me** requests geolocation only after a button press, with a bounded timeout,
coarse accuracy and an area-browsing fallback on denial/unavailability. Search URLs
can contain explicitly supplied origins; no location is saved to account preferences.
Map cameras start from recorded venue locations rather than silently transmitting
the browser's position to a geolocation/tile service.

## Provider configuration

Use a licensed style/tile provider, visible attribution, billing limits, public
browser keys and referrer restrictions. `VITE_MAP_STYLE_URL` is not secret storage.
Do not use public OpenStreetMap tile hosting as an unlimited production CDN.
MapTiler remains a candidate, not a configured/verified production subscription.
No hosted map provider is needed for list browsing or server geosearch.

## References

- [MapLibre installation and Vite worker setup](https://maplibre.org/maplibre-gl-js/docs/)
- [React map wrapper](https://visgl.github.io/react-map-gl/docs/get-started)
- [TanStack hydration boundaries](https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors)
- [PostGIS ST_DWithin](https://postgis.net/docs/ST_DWithin.html)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
