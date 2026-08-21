-- Migration: 0004_user_roles_current_unique
-- 04.1-FIX 6: UNIQUE partial index para prevenir duplicados current.
-- PRIMARY KEY (account_id, role, revoked_at) con revoked_at NULL permite
-- duplicados según SQLite NULL semantics. Este UNIQUE index fuerza que
-- (account_id, role) sea UNIQUE cuando revoked_at IS NULL.

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_current
  ON user_roles(account_id, role) WHERE revoked_at IS NULL;
