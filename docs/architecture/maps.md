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

Desktop uses a floating collapsible results drawer (≈360–440px) over a
full-viewport map; collapsing uses transform only so the map never resizes
or remounts. Mobile uses a large map with a draggable bottom sheet (peek /
half / full snaps) plus an expand control and explicit snap buttons; the
sheet never permanently blocks the map. Marker buttons and list actions
share the selected venue ID; selecting a marker opens a compact
design-token preview in the drawer or sheet (name, address, dish match,
View menu link, close action) without leaving the map workflow. The native
`Popup` overlay is intentionally not used: the installed wrapper never
attaches its native popup instance in this stack (verified with zero
console errors — the instance stays closed while markers, attribution and
camera all work), and a DOM card is keyboard-focusable, styled and
announced like the rest of the UI. Selecting a marker scrolls the matching
card into view; a card's Show-on-map action selects the marker. Opening a
preview moves focus to its heading; closing returns focus to results. The
list remains a keyboard-accessible alternative to map interaction. Camera
moves use restrained `easeTo` (instant `jumpTo` under
`prefers-reduced-motion`). Map padding keeps selected markers clear of the
drawer and sheet. Cooperative gestures avoid capturing normal mobile page
scrolling. The map renders whenever it is configured, even with zero
results. Map cameras never initialize at longitude 0, latitude 0.

Only settled user map movements update proposed bounds. The user explicitly
chooses a floating **Search this map area** pill; there are no per-frame
database requests. Wrapped world coordinates are normalized before validated
navigation, preserving antimeridian boxes. Results are capped at 50. Map
failure or missing configuration keeps the list, address and external
directions available.

Camera state is explicit and separated:

- **Initial resolution** (mount once): an explicit URL region wins; else a
  previously user-selected stored city applies its bounds; else an already
  granted geolocation silently centers the user once; otherwise a compact
  chooser offers cities plus **Use my location**. Country-scale defaults
  never pretend to be nearby discovery, and no permission prompt fires on
  load.
- **Explicit framing** (city apply, recenter, restored session camera) wins
  over result fitting exactly once per request.
- **User gestures** set a sticky flag that suppresses later auto-fits; a new
  search (new fit key) re-arms fitting.
- **Result fitting** frames points with drawer/sheet-aware padding and a
  sensible maximum zoom.
- **Selection** centers the venue at street scale (zoom 15–17) with padding
  that keeps it clear of overlays.
- Exact camera positions persist in `sessionStorage` per search so returning
  from restaurant details restores the view; the map never re-centers
  continuously after a manual pan.

**Near Me** and the recenter button request geolocation only on press, with
a bounded timeout and an area-browsing fallback on denial/unavailability.
The known user position renders as a distinct marker (with reported accuracy
only when the provider supplies a positive value) and is independent of the
browsed area: exploring Hanoi while physically in Ho Chi Minh City keeps
both visible. Search URLs can contain explicitly supplied origins; no
location is saved to account preferences. A stored city choice lives in
`localStorage` only. Map cameras start from recorded venue locations rather
than silently transmitting the browser's position to a geolocation/tile
service.

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
