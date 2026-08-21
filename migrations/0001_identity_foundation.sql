-- Migration: 0001_identity_foundation
-- Objetivo: Foundation de datos para Identity 04.0 (passwordless-first, magic link).
-- Alcance: solo-schema; NO booking/signup/login endpoints.
-- Garantías:
--  - Idempotente (CREATE IF NOT EXISTS).
--  - Un forever: no toca properties data real/legacy prop 9.
--  - Cero data loss: properties sigue operando, properties.id INTEGER prevalece.
--  - Cero autenticación/session behavior (solo schemas e indices).
-- Access patterns e invariantes protegidos por DB (no solo Worker):
--  - Email: UNIQUE (case-normalized por Worker lower()).
--  - user_roles: composite UNIQUE.
--  - ownership mental: created_by vs account-agent etc. por listing_owners.
--  - sessions: current/expiry por índices; revocación vía revoked_at.

PRAGMA foreign_keys = ON;

-- =============================================================
-- ACCOUNTS — ENTIDAD PRINCIPAL DE IDENTIDAD (04.0 #3)
-- =============================================================

CREATE TABLE IF NOT EXISTS accounts (
  -- PK: ULID/crypto.randomUUID() como TEXT; Non-sequential, non-reusable.
  id TEXT PRIMARY KEY,

  -- Email (identificador primario), lowercase() normalizado en worker.
  email TEXT NOT NULL UNIQUE,

  -- Phone opcional nullable, UNIQUE (no asumimos multi-formatos = multi-identidades).
  phone TEXT,

  -- Password: nullable; solo legacy path (Argon2id). No requerido desde MVP.
  password_hash TEXT,

  email_verified_at TEXT,
  phone_verified_at TEXT,

  -- Account status: active|suspended|deleted (browsed anon vs account-closed).
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),

  -- Deletion (04.0 ADR-008): soft-delete → anonymize with grace window.
  deletion_state TEXT NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active','pending','anonymized')),
  deleted_at TEXT,

  -- Security: cambios de password / revocaciones globales rotan este stamp.
  security_stamp TEXT NOT NULL DEFAULT '',

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- =============================================================
-- PROFILES — SEPARACIÓN (04.0 #6): display_name/avatar/idioma
-- =============================================================

CREATE TABLE IF NOT EXISTS profiles (
  -- FB 1:1 -> accounts.id (restrict; no orphan profile). Soft lifecycle inherits accounts.
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,

  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  city TEXT,
  language TEXT DEFAULT 'es',
  agent_verification TEXT,
  contact_preferences TEXT,  -- JSON: opt-in public contact opts

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================
-- ROLES — CATALOG + USER_ROLES (04.0 #7-8)
-- Ownership ≠ rol; solo MODERATOR/ADMIN/SUPERADMIN (y AGENCY futura).
-- =============================================================

CREATE TABLE IF NOT EXISTS roles (
  name TEXT PRIMARY KEY CHECK (name IN ('MODERATOR','ADMIN','SUPERADMIN','AGENCY'))
);
INSERT OR IGNORE INTO roles (name) VALUES ('AGENCY');
INSERT OR IGNORE INTO roles (name) VALUES ('ADMIN');
INSERT OR IGNORE INTO roles (name) VALUES ('MODERATOR');
INSERT OR IGNORE INTO roles (name) VALUES ('SUPERADMIN');

-- Concede roles temporales; revocación actualiza security_stamp.
CREATE TABLE IF NOT EXISTS user_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (account_id, role)
);

-- =============================================================
-- SESSIONS FOUNDATION (04.0 #9: data structure only, NO behavior)
-- =============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL,            -- hashed token digest (no plaintext)
  device_label TEXT,
  user_agent TEXT,
  ip_subset TEXT,                      -- IP truncada/subnet por design
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- =============================================================
-- LISTING OWNERSHIP (04.0 #10): ROLE ≠ OWNERSHIP
-- =============================================================

-- properties no se renombra; created_by añadido backward-compat si falta.
-- Legacy owner_name/owner_phone/contact_email sigue existiendo (no data loss).
CREATE TABLE IF NOT EXISTS listing_owners (
  listing_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','agent','managed_by')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (listing_id, account_id)
);

-- =============================================================
-- MODERATION EVENTS (04.0 #12): state machine events, IMMUTABLE
-- =============================================================

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  actor_id TEXT REFERENCES accounts(id),
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason TEXT,
  request_correlation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_listing_id ON moderation_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actor_id ON moderation_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_moderation_created_at ON moderation_events(created_at);

-- =============================================================
-- AUDIT EVENTS APPEND-ONLY (04.0 #13)
-- =============================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES accounts(id),
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','anonymous','system')),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT,                       -- JSON (no secretos)
  correlation_id TEXT,
  actor_ip_subset TEXT,
  actor_user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at);

-- =============================================================
-- INDEX PRESENTATION (by pattern)
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_profiles_language ON profiles(language);
CREATE INDEX IF NOT EXISTS idx_user_roles_account_id ON user_roles(account_id);
CREATE INDEX IF NOT EXISTS idx_listing_owners_account_id ON listing_owners(account_id);
