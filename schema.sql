-- schema.sql - NEXO Unificado (04.4.1: modelo canónico listing identity)
-- Bootstrap local únicamente. Las tablas Identity vienen de migrations/.
-- Producción se alinea vía 0005_canonical_listing_identity.sql.
DROP TABLE IF EXISTS properties;
CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- identificador interno (relaciones)
    public_code TEXT NOT NULL UNIQUE,     -- identificador público estable 'N-001'
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'casa', 'apartamento', 'terreno', 'penthouse'
    operation TEXT NOT NULL DEFAULT 'venta', -- 'venta', 'alquiler'
    price REAL NOT NULL,
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    address TEXT, -- Dirección exacta (Privado)
    bedrooms INTEGER DEFAULT 0,
    bathrooms INTEGER DEFAULT 0,
    area REAL, -- Metros cuadrados
    description TEXT,
    images TEXT, -- Formato JSON: ["url1", "url2", "url3"]
    latitude REAL,
    longitude REAL,
    status TEXT NOT NULL DEFAULT 'published', -- 'published', 'draft'
    owner_name TEXT, -- Datos privados
    owner_phone TEXT, -- Datos privados
    internal_notes TEXT, -- Datos privados
    contact_email TEXT, -- legacy (privado)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generador de public_code delete-safe (nunca reusa códigos tras DELETE)
CREATE TABLE IF NOT EXISTS listing_id_sequence (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO listing_id_sequence (name, value) VALUES ('public_code', 0);
