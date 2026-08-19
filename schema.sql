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
  -- Sello de verificación interno (badge público).
  verified      INTEGER NOT NULL DEFAULT 0,
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

-- Escalabilidad provincial: búsquedas/geo por provincia.
CREATE INDEX IF NOT EXISTS idx_properties_province
  ON properties (province);

-- Comparación lado a lado: resolución por IDs ya cubierta por
-- la PRIMARY KEY. Orden futura por precio.
CREATE INDEX IF NOT EXISTS idx_properties_price
  ON properties (price);

-- ============================================================
-- PREPARACIÓN FUTURA (vacías hasta su activación)
-- Favoritos y cuentas de usuario.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT,
  role          TEXT    NOT NULL DEFAULT 'user'
                CHECK (role IN ('user', 'admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL
                REFERENCES users (id) ON DELETE CASCADE,
  property_id   INTEGER NOT NULL
                REFERENCES properties (id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user
  ON favorites (user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_property
  ON favorites (property_id);
