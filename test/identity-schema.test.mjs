import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PY_RUNNER = `
import sqlite3, json, sys
db = sqlite3.connect(sys.argv[1])
db.execute('PRAGMA foreign_keys = ON')
stmts = json.load(sys.stdin)
out = {"ok": True}
try:
    for s in stmts:
        db.execute(s) if ";" not in s.rstrip(";") else db.executescript(s)
    db.commit()
except Exception as e:
    out = {"ok": False, "error": str(e)}
print(json.dumps(out))
`;

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DB temporal persistente por test: el runner es único-thread, así almacena el dir.
let dbFile;
let tmpDir;

function openDb() {
  tmpDir = mkdtempSync(join(tmpdir(), "nexo-id-schema-"));
  dbFile = join(tmpDir, "test.db");
  const sql = readFileSync(resolve(ROOT, "migrations/0001_identity_foundation.sql"), "utf8");
  const r = sqlRun([sql]);
  assert.ok(r.ok, `bootstrap failed: ${r.error}`);
}

function sqlRun(statements) {
  const proc = spawnSync("python3", ["-c", PY_RUNNER, dbFile], {
    cwd: ROOT,
    input: JSON.stringify(statements),
    encoding: "utf8"
  });
  const stdout = (proc.stdout || "").trim();
  try {
    return JSON.parse(stdout);
  } catch {
    return { ok: false, error: `spawn parse fail: ${stdout.slice(0, 200)}` };
  }
}

function closeDb(t) {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

/* =========================================================
   25.1–25.10 — IDENTITY SCHEMA INTEGRITY
========================================================= */

test("25.1 user creation", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO accounts (id, email) VALUES ('u1', 'alice@nexo.test')"]);
  assert.ok(r.ok, r.error);
});

test("25.2 duplicate email rejected", t => {
  openDb(); t.after(closeDb);
  sqlRun(["INSERT INTO accounts (id, email) VALUES ('u1', 'alice@nexo.test')"]);
  const r = sqlRun(["INSERT INTO accounts (id, email) VALUES ('u2', 'alice@nexo.test')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /UNIQUE constraint failed/i);
});

test("25.3 profile requires valid user", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO profiles (account_id) VALUES ('ghost')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /FOREIGN KEY/i);
});

test("25.4 invalid foreign key rejected", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO user_roles (account_id, role) VALUES ('ghost', 'MODERATOR')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /FOREIGN KEY/i);
});

test("25.5 duplicate role assignment rejected", t => {
  openDb(); t.after(closeDb);
  sqlRun(["INSERT INTO accounts (id, email) VALUES ('u1', 'alice@nexo.test')"]);
  sqlRun(["INSERT INTO user_roles (account_id, role) VALUES ('u1', 'MODERATOR')"]);
  const r = sqlRun(["INSERT INTO user_roles (account_id, role) VALUES ('u1', 'MODERATOR')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /UNIQUE constraint failed/i);
});

test("25.6 session references valid user", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES ('s1', 'ghost', 'hash', '2030-01-01')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /FOREIGN KEY/i);
});

test("25.7 ownership references valid identity", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO listing_owners (listing_id, account_id, relationship) VALUES ('9', 'ghost', 'owner')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /FOREIGN KEY/i);
});

test("25.8 moderation references valid actor/resource", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO moderation_events (id, listing_id, actor_id, previous_state, new_state) VALUES ('m1', '9', 'ghost', 'draft', 'submitted')"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /FOREIGN KEY/i);
});

test("25.9 audit record can be created", t => {
  openDb(); t.after(closeDb);
  const r = sqlRun(["INSERT INTO audit_events (id, actor_type, action, correlation_id) VALUES ('a1', 'system', 'BOOTSTRAP', 'corr-001')"]);
  assert.ok(r.ok, r.error);
});

test("25.10 deleted/anonymized account follows defined strategy", t => {
  openDb(); t.after(closeDb);
  sqlRun(["INSERT INTO accounts (id, email) VALUES ('u1', 'alice@nexo.test')"]);
  // ADR-008: soft delete → deletion_state=anonymized; email/phone placeholder determinista.
  const r = sqlRun([
    "UPDATE accounts SET deletion_state='anonymized', deleted_at=datetime('now'), email='deleted-'||id||'@deleted.local', phone=NULL, password_hash=NULL WHERE id='u1'"
  ]);
  assert.ok(r.ok, r.error);
});
