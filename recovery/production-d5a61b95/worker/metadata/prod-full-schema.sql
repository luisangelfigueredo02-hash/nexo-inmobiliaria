-- PRODUCTION nexo-db full schema (read-only extract via wrangler d1 execute --remote, sqlite_master)
-- Generated 2026-08-22; excludes _cf_KV (internal) and auto-indexes

CREATE TABLE "accounts" (
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

CREATE TABLE analytics_counters (
  kind          TEXT    NOT NULL,
  day           TEXT    NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, day)
);

CREATE TABLE analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,
  property_id INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_events (
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

CREATE TABLE "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE favorites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL
                REFERENCES users (id) ON DELETE CASCADE,
  property_id   INTEGER NOT NULL
                REFERENCES properties (id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, property_id)
);

CREATE TABLE ia_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT,
              event_type TEXT,
              event_data TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE ia_feedback (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT,
              rating TEXT,
              user_message TEXT,
              assistant_answer TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE ia_sessions (
              session_id TEXT PRIMARY KEY,
              preferences TEXT,
              total_messages INTEGER DEFAULT 0,
              first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
              last_seen TEXT DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE listing_id_sequence (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE listing_owners (
  listing_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','agent','managed_by')),
  created_by   TEXT REFERENCES accounts(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  PRIMARY KEY (listing_id, account_id)
);

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

CREATE TABLE profiles (
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

CREATE TABLE "properties" (
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
, currency TEXT);

CREATE TABLE rate_limits (
        key TEXT, window_start INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
        expiry INTEGER NOT NULL, PRIMARY KEY (key, window_start)
      );

CREATE TABLE roles (
  name TEXT PRIMARY KEY CHECK (name IN ('MODERATOR','ADMIN','SUPERADMIN','AGENCY'))
);

CREATE TABLE sessions (
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

CREATE TABLE user_favorites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL
                REFERENCES users (id) ON DELETE CASCADE,
  property_id   INTEGER NOT NULL
                REFERENCES properties (id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, property_id)
);

CREATE TABLE user_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  granted_by TEXT REFERENCES accounts(id),   -- actor FK nullable
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (account_id, role, revoked_at)
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT,
  role          TEXT    NOT NULL DEFAULT 'user'
                CHECK (role IN ('user', 'admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_analytics_day
  ON analytics_counters (day);

CREATE INDEX idx_analytics_events_kind
  ON analytics_events (kind);

CREATE INDEX idx_audit_action ON audit_events(action);

CREATE INDEX idx_audit_actor_id ON audit_events(actor_id);

CREATE INDEX idx_audit_correlation_id ON audit_events(correlation_id);

CREATE INDEX idx_audit_created_at ON audit_events(created_at);

CREATE INDEX idx_favorites_property
  ON favorites (property_id);

CREATE INDEX idx_favorites_user
  ON favorites (user_id);

CREATE INDEX idx_listing_owners_account_id ON listing_owners(account_id);

CREATE INDEX idx_moderation_actor_id   ON moderation_events(actor_id);

CREATE INDEX idx_moderation_created_at ON moderation_events(created_at);

CREATE INDEX idx_moderation_listing_id ON moderation_events(listing_id);

CREATE INDEX idx_profiles_language ON profiles(language);

CREATE INDEX idx_properties_city           ON properties (city);

CREATE INDEX idx_properties_created_by     ON properties (created_by);

CREATE INDEX idx_properties_geo            ON properties (latitude, longitude);

CREATE INDEX idx_properties_price          ON properties (price);

CREATE INDEX idx_properties_province       ON properties (province);

CREATE INDEX idx_properties_status_created ON properties (status, created_at DESC);

CREATE INDEX idx_properties_type           ON properties (type);

CREATE INDEX idx_sessions_account_id ON sessions(account_id);

CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE UNIQUE INDEX idx_sessions_token_hash
  ON sessions(token_hash) WHERE revoked_at IS NULL;

CREATE INDEX idx_user_favorites_property
  ON user_favorites (property_id);

CREATE INDEX idx_user_favorites_user
  ON user_favorites (user_id);

CREATE UNIQUE INDEX idx_user_roles_current
  ON user_roles(account_id, role) WHERE revoked_at IS NULL;

CREATE INDEX idx_user_roles_granted_by ON user_roles(granted_by)