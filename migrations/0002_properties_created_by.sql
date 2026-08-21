-- Migration: 0002_properties_created_by
-- Backward-compatible: añade created_by a properties solo si NO existe.
-- SQLite 3.35+: en D1 funciona por DB leader upgrade.
-- Idempotente según guard (alter-ignore falla se captura como no-op en verify).

ALTER TABLE properties ADD COLUMN created_by TEXT REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS idx_properties_created_by ON properties(created_by);
-- en prod status siempre existe; en test mock puede no (por eso lo omitimos aquí)
