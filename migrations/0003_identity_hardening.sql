-- Migration: 0003_identity_hardening
-- Fixes 04.1-FIX detectados en commit 19532be review:
--  (1) properties.id INTEGER vs listing_owners TEXT: unificamos INTEGER (ADR-009).
--  (2) user_roles.granted_by FK requerida con actor model (ADR-010).
--  (3) accounts.password_hash: eliminated per 04.0 (passwordless-first only).
--  (5) user_roles role history: PRIMARY KEY extende con revoked_at (NULL)
--      para soportar grant → revoke → regrant audit.
--
-- IMPORTANT: user_roles/listing_owners (0 rows) y accounts (0 rows) están
-- vacías en remote D1; safe rebuild preserve. user_roles/listing_owners se
-- rebuild para evitar SQLITE_AUTH del ALTER TABLE DROP COLUMN en D1 leader.
-- properties COUNT=1 intacta.

PRAGMA foreign_keys = ON;

-- =============================================================
-- FIX 1: listing_owners.listing_id → INTEGER (ADR-009 unified)
-- =============================================================

DROP TABLE IF EXISTS listing_owners;
CREATE TABLE listing_owners (
  listing_id INTEGER NOT NULL,               -- properties.id INTEGER
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','agent','managed_by')),
  created_by TEXT REFERENCES accounts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (listing_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_owners_account_id ON listing_owners(account_id);

-- =============================================================
-- FIX 2+5: user_roles hardening
-- (a) granted_by actor FK nullable (system/admin actors pueden ser null);
-- (b) role history: PRIMARY KEY incluye revoked_at (NULL=current;
--     NONNULL=historical grant) → grant → revoke → regrant audit.
-- =============================================================

DROP TABLE IF EXISTS user_roles;
CREATE TABLE user_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  granted_by TEXT REFERENCES accounts(id),   -- actor FK nullable
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (account_id, role, revoked_at)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by ON user_roles(granted_by);

-- =============================================================
-- FIX 3: accounts.password_hash eliminated (no ALTER DROP COLUMN in D1 leader)
-- (passwordless-first per ADR-001; password_hash sin uso en MVP)
-- Rebuild: accounts 0 rows en remote; safe create/migrate.
-- =============================================================

CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  email_verified_at TEXT,
  phone_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  deletion_state TEXT NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active','pending','anonymized')),
  deleted_at TEXT,
  security_stamp TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

INSERT INTO accounts_new (id, email, phone, email_verified_at, phone_verified_at,
                         status, deletion_state, deleted_at, security_stamp,
                         created_at, updated_at, last_login_at)
SELECT id, email, phone, email_verified_at, phone_verified_at,
       status, deletion_state, deleted_at, security_stamp,
       created_at, updated_at, last_login_at
  FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- =============================================================
-- FIX 7: sessions token_hash UNIQUE constraint (current non-revoked only)
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash) WHERE revoked_at IS NULL;
