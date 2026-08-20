-- schema.sql - NEXO Unificado
DROP TABLE IF EXISTS properties;
CREATE TABLE properties (
    id TEXT PRIMARY KEY, -- Formato estructurado: N-001, N-002, etc.
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'casa', 'apartamento', 'terreno', 'penthouse'
    operation TEXT NOT NULL, -- 'venta', 'alquiler'
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);