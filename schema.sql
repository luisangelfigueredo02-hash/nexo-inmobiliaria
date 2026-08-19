-- ============================================================
-- NEXO Inmueble — Esquema de base de datos (Cloudflare D1)
-- ============================================================
--
-- Aplicar con:
--   wrangler d1 execute nexo-db --remote --file=schema.sql
--
-- Es idempotente (IF NOT EXISTS): seguro de ejecutar sobre la
-- base de datos en producción sin tocar los datos existentes.
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_type TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  province      TEXT,
  city          TEXT    NOT NULL,
  neighborhood  TEXT,
  address       TEXT    NOT NULL,
  latitude      REAL,
  longitude     REAL,
  bedrooms      INTEGER,
  bathrooms     INTEGER,
  square_meters REAL,
  price         REAL    NOT NULL CHECK (price >= 0),
  description   TEXT,
  photos        TEXT    NOT NULL DEFAULT '[]',
  owner_name    TEXT,
  owner_phone   TEXT,
  contact_email TEXT,
  notes         TEXT,
  status        TEXT    NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'reserved', 'sold')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Listado público: propiedades disponibles ordenadas por fecha.
CREATE INDEX IF NOT EXISTS idx_properties_status_created
  ON properties (status, created_at DESC);

-- Mapa: búsquedas por zona geográfica.
CREATE INDEX IF NOT EXISTS idx_properties_geo
  ON properties (latitude, longitude);

-- Filtros habituales: ciudad y tipo de propiedad.
CREATE INDEX IF NOT EXISTS idx_properties_city
  ON properties (city);

CREATE INDEX IF NOT EXISTS idx_properties_type
  ON properties (property_type);
