-- 0006_public_user_auth.sql
-- FASE 07: sistema público de usuarios (registro/login/favoritos).
--
-- DECISIÓN (documentada en reports/07): la spec 04.0 era passwordless-first
-- (passkeys + magic link), pero magic link requiere un proveedor de email
-- inexistente. Para un producto vendible y funcional se adopta
-- email+password con PBKDF2-SHA256 (WebCrypto, sin dependencias externas).
--
-- accounts.password_hash vuelve a existir (la eliminación en 0003 respondía
-- a la estrategia passwordless original).

ALTER TABLE accounts ADD COLUMN password_hash TEXT;

-- Favoritos persistentes por cuenta (las tablas legacy favorites /
-- user_favorites referencian la tabla legacy `users` INTEGER; no se reusan).
CREATE TABLE IF NOT EXISTS account_favorites (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_account_favorites_account ON account_favorites(account_id);
