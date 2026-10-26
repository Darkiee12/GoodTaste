-- PostgreSQL/PostGIS spatial prerequisite. Schema migration only.
-- The official PostGIS image already creates the extension in public on new DBs.
-- Managed PostgreSQL must provision the PostGIS extension with suitable privileges.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
