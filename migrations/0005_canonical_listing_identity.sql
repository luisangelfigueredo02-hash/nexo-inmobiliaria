-- Migration: 0005_canonical_listing_identity (04.4.1)
-- Modelo canónico: properties.id INTEGER PK (interno) + public_code TEXT
-- NOT NULL UNIQUE (público, 'N-001'). Relaciones internas alineadas a INTEGER.
-- Aplicado solo a local; producción requiere aprobación explícita (04.4.1 §21).
-- Snapshot producción (2026-08-21): properties=1 (id=9, public_code 'N-001'),
-- listing_owners=0, moderation_events=0 → rebuilds seguros sin pérdida.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------
-- 1. Generador de public_code delete-safe (nunca reusa códigos)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_id_sequence (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT INTO listing_id_sequence (name, value)
SELECT 'public_code',
       COALESCE((SELECT MAX(CAST(SUBSTR(public_code, 3) AS INTEGER))
                 FROM properties WHERE public_code LIKE 'N-%'), 0)
WHERE NOT EXISTS (
  SELECT 1 FROM listing_id_sequence WHERE name = 'public_code'
);

-- ---------------------------------------------------------------
-- 2. properties rebuild: public_code NOT NULL UNIQUE
--    (todos los legacy columns y datos preservados; índices recreados)
-- ---------------------------------------------------------------
CREATE TABLE properties_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT,
  city           TEXT,
  neighborhood   TEXT,
  address        TEXT,
  bedrooms       INTEGER,
  bathrooms      INTEGER,
  area           REAL,
  price          REAL,
  description    TEXT,
  images         TEXT,
  owner_name     TEXT,
  owner_phone    TEXT,
  internal_notes TEXT,
  status         TEXT DEFAULT 'available',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  latitude       REAL,
  longitude      REAL,
  title          TEXT,
  province       TEXT,
  contact_email  TEXT,
  verified       INTEGER DEFAULT 0,
  placa_libre    INTEGER NOT NULL DEFAULT 0,
  gas_calle      INTEGER NOT NULL DEFAULT 0,
  agua_247       INTEGER NOT NULL DEFAULT 0,
  pago_exterior  INTEGER NOT NULL DEFAULT 0,
  embedding_id   TEXT,
  public_code    TEXT NOT NULL UNIQUE,
  agreed_price   REAL,
  commission     REAL,
  operation      TEXT NOT NULL DEFAULT 'venta',
  created_by     TEXT REFERENCES accounts(id)
);

INSERT INTO properties_new (
  id, type, city, neighborhood, address, bedrooms, bathrooms, area, price,
  description, images, owner_name, owner_phone, internal_notes, status,
  created_at, latitude, longitude, title, province, contact_email, verified,
  placa_libre, gas_calle, agua_247, pago_exterior, embedding_id, public_code,
  agreed_price, commission, operation, created_by
)
SELECT id, type, city, neighborhood, address, bedrooms, bathrooms, area, price,
       description, images, owner_name, owner_phone, internal_notes, status,
       created_at, latitude, longitude, title, province, contact_email, verified,
       placa_libre, gas_calle, agua_247, pago_exterior, embedding_id, public_code,
       agreed_price, commission, operation, created_by
  FROM properties;

DROP TABLE properties;
ALTER TABLE properties_new RENAME TO properties;

-- índices explícitos preexistentes (UNIQUE public_code vía constraint)
CREATE INDEX IF NOT EXISTS idx_properties_status_created ON properties (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_geo            ON properties (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_properties_city           ON properties (city);
CREATE INDEX IF NOT EXISTS idx_properties_type           ON properties (type);
CREATE INDEX IF NOT EXISTS idx_properties_province       ON properties (province);
CREATE INDEX IF NOT EXISTS idx_properties_price          ON properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_created_by     ON properties (created_by);

-- ---------------------------------------------------------------
-- 3. listing_owners rebuild: FK real a properties(id)
--    ON DELETE CASCADE: ownership muere con el listing; el rastro
--    audit vive en moderation_events/audit_events (no CASCADE allí)
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS listing_owners;
CREATE TABLE listing_owners (
  listing_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','agent','managed_by')),
  created_by   TEXT REFERENCES accounts(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  PRIMARY KEY (listing_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_owners_account_id ON listing_owners(account_id);

-- ---------------------------------------------------------------
-- 4. moderation_events rebuild: listing_id INTEGER alineado.
--    SIN FK a propósito: historial de moderación debe sobrevivir
--    al borrado del listing (audit), CASCADE destructivo prohibido.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS moderation_events;
CREATE TABLE moderation_events (
  id                     TEXT PRIMARY KEY,
  listing_id             INTEGER NOT NULL,
  actor_id               TEXT REFERENCES accounts(id),
  previous_state         TEXT NOT NULL,
  new_state              TEXT NOT NULL,
  reason                 TEXT,
  request_correlation_id TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moderation_listing_id ON moderation_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actor_id   ON moderation_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_moderation_created_at ON moderation_events(created_at);
