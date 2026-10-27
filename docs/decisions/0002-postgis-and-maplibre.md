# ADR 0002 — PostGIS geosearch and MapLibre React map

- **Status:** Accepted for scaffold
- **Date:** 2026-10-27

## Decision

Restaurant Discovery uses **PostgreSQL 18 + PostGIS 3.6** for source-of-truth venue locations and spatial queries; no OpenSearch index in MVP. React UI uses **MapLibre GL JS** with maintained **`react-map-gl/maplibre`** wrapper, loaded client-only within TanStack Start. A MapTiler-hosted vector style is the first tile-provider recommendation, pending key/license/cost review. Map and restaurant/Places datasets are distinct services.

Domain queries use Reylo SQL, typed operations run under Effect, HTTP input uses Zod 4.6, and Flyway owns migration/index DDL. Favor `geography(Point,4326)` and GiST for distance queries once physical restaurant schema is approved.

Local infrastructure uses `postgis/postgis:18-3.6-alpine`, currently **AMD64-only**. This image preloads PostGIS objects in `public`; Flyway uses `feastjourney` as its separate application/default schema and history, with `baselineOnMigrate=false`. A first Flyway migration records the PostGIS extension prerequisite. Production/ARM64 installations require verified support and explicit role/extension provisioning.

## Alternatives considered

- **OpenSearch:** powerful text scoring and geo filters, but adds a separately synchronized cluster and eventual-consistency risks.
- **React Leaflet:** viable, but MapLibre vector rendering and GPU-backed styling/clustering fit the intended map/list discovery experience.
- **Mapbox/Google Maps:** vendor-specific rendering, API billing and key terms; can revisit independently if POI or geocoding needs require it.
- **Imperative MapLibre useEffect setup:** unnecessary lifecycle work compared with a maintained React wrapper.
- **Public OSM tiles as production CDN:** open OSM data does not mean unlimited public tile hosting.

## Consequences / future work

No application restaurant tables or map components are created by this decision. Add spatial column/index via reviewed Flyway migration, install map packages only when UI is developed, choose hosted tile plan and geocoding/POI data providers separately, and measure real geo query latency before considering OpenSearch.

See [maps and geosearch](../architecture/maps.md) and [migration operations](../infra/migrations.md).
