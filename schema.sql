-- schema.sql - NEXO Unificado (bootstrap local/desarrollo)
-- Contrato canónico de `properties`: superset de todas las migrations
-- (0001-0007). Producción se alinea vía migrations; este archivo solo
-- inicializa entornos nuevos. Columnas marcadas (private) jamás se
-- exponen en la API pública (serializeProperty, doble barrera).
DROP TABLE IF EXISTS properties;
CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- identificador interno (relaciones)
    public_code TEXT NOT NULL UNIQUE,     -- identificador público estable 'N-001'
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'casa', 'apartamento', 'terreno', 'penthouse'
    operation TEXT NOT NULL DEFAULT 'venta', -- 'venta', 'alquiler'
    price REAL NOT NULL,
    currency TEXT, -- 'USD', 'EUR', 'CUP' (0007; normalizeCurrency en worker.js)
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    address TEXT, -- Dirección exacta (private)
    bedrooms INTEGER DEFAULT 0,
    bathrooms INTEGER DEFAULT 0,
    area REAL, -- Metros cuadrados
    description TEXT,
    images TEXT, -- Formato JSON: ["url1", "url2", "url3"]
    latitude REAL,
    longitude REAL,
    status TEXT NOT NULL DEFAULT 'published', -- 'published', 'draft'
    owner_name TEXT, -- (private)
    owner_phone TEXT, -- (private)
    internal_notes TEXT, -- (private)
    contact_email TEXT, -- (private, legacy)
    verified INTEGER DEFAULT 0,
    placa_libre INTEGER NOT NULL DEFAULT 0,
    gas_calle INTEGER NOT NULL DEFAULT 0,
    agua_247 INTEGER NOT NULL DEFAULT 0,
    pago_exterior INTEGER NOT NULL DEFAULT 0,
    embedding_id TEXT,
    agreed_price REAL, -- (private)
    commission REAL, -- (private)
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generador de public_code delete-safe (nunca reusa códigos tras DELETE)
CREATE TABLE IF NOT EXISTS listing_id_sequence (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO listing_id_sequence (name, value) VALUES ('public_code', 0);
