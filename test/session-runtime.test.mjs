import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import {
  generateSessionToken,
  hashSessionToken,
  buildSessionCookie,
  buildSessionClearCookie,
  parseSessionTokens,
  createSession,
  getAuthenticatedSession,
  revokeSession,
  revokeAllSessions,
  rotateSession,
  destroySession,
  isStateChangingAllowed,
  SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
} from "../session-runtime.js";


/* =========================================================
   04.3 — SESSION RUNTIME tests.
   D1 fake determinista en memoria: mismo contrato que D1 real
   (prepare/bind/first/all/run) sobre las tablas accounts y
   sessions del schema FROZEN. Sin mocks de terceros.
========================================================= */

const BASE = "https://nexo-inmueble.example.workers.dev";
const ACCOUNT_A = "acc-ulid-a";
const ACCOUNT_B = "acc-ulid-b";

async function sha256Hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeD1(seedAccounts = [{ id: ACCOUNT_A, status: "active", security_stamp: "stamp-a" }]) {
  const state = { accounts: seedAccounts.map(a => ({ ...a })), sessions: [] };

  function q(sql) {
    const norm = sql.replace(/\s+/g, " ").trim();
    const st = {
      bind(...args) { this._args = args; return this; },
      _args: [],

      async first() {
        const [a, b] = this._args;
        if (norm.startsWith("SELECT requests")) return null; // rate limit: sin límite
        if (norm.startsWith("SELECT s.id")) {
          // validación: token_hash → sesión no revocada + join cuenta
          const row = state.sessions.find(s => s.token_hash === a && s.revoked_at === null);
          if (!row) return null;
          const acc = state.accounts.find(x => x.id === row.account_id);
          if (!acc) return null;
          return {
            id: row.id, account_id: row.account_id, expires_at: row.expires_at,
            last_seen_at: row.last_seen_at,
            account_status: acc.status, account_security_stamp: acc.security_stamp,
          };
        }
        throw new Error("first() no esperado: " + norm);
      },

      async all() {
        const [a] = this._args;
        if (norm.startsWith("SELECT id, created_at FROM sessions")) {
          return { results: state.sessions
            .filter(s => s.account_id === a && s.revoked_at === null)
            .map(s => ({ id: s.id, created_at: s.created_at })) };
        }
        throw new Error("all() no esperado: " + norm);
      },

      async run() {
        if (norm.startsWith("CREATE TABLE")) return {};
        const args = this._args;

        if (norm.startsWith("INSERT INTO sessions")) {
          const [id, account_id, token_hash, device_label, user_agent, ip_subset, created_at, expires_at, last_seen_at] = args;
          state.sessions.push({ id, account_id, token_hash, device_label, user_agent, ip_subset, created_at, expires_at, revoked_at: null, last_seen_at });
          return { meta: { changes: 1 } };
        }
        if (norm.includes("IN ( SELECT id FROM sessions")) {
          // límite de concurrencia: revoca las más antiguas que excedan el cap
          // (ORDER BY created_at DESC, rowid DESC — rowid ≈ orden de inserción)
          const [revokedAt, accountId, max] = args;
          const active = state.sessions
            .map((s, rowid) => ({ s, rowid }))
            .filter(({ s }) => s.account_id === accountId && s.revoked_at === null)
            .sort((a, b) =>
              (b.s.created_at !== a.s.created_at)
                ? b.s.created_at.localeCompare(a.s.created_at)
                : b.rowid - a.rowid);
          for (const { s } of active.slice(max)) s.revoked_at = revokedAt;
          return { meta: { changes: Math.max(active.length - max, 0) } };
        }
        if (norm.startsWith("UPDATE sessions SET last_seen_at")) {
          const [ts, id] = args;
          const s = state.sessions.find(x => x.id === id);
          if (s) s.last_seen_at = ts;
          return { meta: { changes: s ? 1 : 0 } };
        }
        if (norm.startsWith("UPDATE sessions SET revoked_at")) {
          const [ts, key] = args;
          let changes = 0;
          for (const s of state.sessions) {
            const match = norm.includes("WHERE id =") ? s.id === key
              : norm.includes("WHERE token_hash =") ? s.token_hash === key
              : norm.includes("WHERE account_id =") ? s.account_id === key
              : false;
            if (match && s.revoked_at === null) { s.revoked_at = ts; changes++; }
          }
          return { meta: { changes } };
        }
        if (norm.startsWith("INSERT INTO rate_limits") || norm.startsWith("DELETE FROM rate_limits")) {
          return { meta: { changes: 0 } };
        }
        throw new Error("run() no esperado: " + norm);
      },
    };
    return st;
  }

  return { prepare: q, state };
}

function makeEnv(seedAccounts) {
  const db = makeD1(seedAccounts);
  return { DB: db, state: db.state };
}

function cookieHeader(token) {
  return `other=1; ${SESSION_COOKIE_NAME}=${token}; theme=dark`;
}

function req(path, init = {}) {
  return new Request(BASE + path, init);
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}


/* =========================================================
   SESSION CREATION — §3, §6
========================================================= */

test("CREACIÓN: token de 256 bits (43 chars base64url), único, no derivable", async () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
  assert.equal(tokens.size, 200, "200 tokens generados deben ser únicos");
  for (const t of tokens) {
    assert.match(t, /^[A-Za-z0-9_-]{43}$/, "base64url de 32 bytes");
    assert.ok(!t.includes(ACCOUNT_A), "no contiene account_id");
    assert.ok(!/^\d+$/.test(t), "no es un timestamp");
  }
});

test("CREACIÓN: D1 almacena SHA-256 hex del token, nunca el plaintext", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, { userAgent: "UA", ipSubset: "1.2.3.0/24" });

  assert.equal(env.state.sessions.length, 1);
  const row = env.state.sessions[0];
  assert.equal(row.token_hash, await sha256Hex(token));
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.account_id, ACCOUNT_A);
  assert.equal(row.revoked_at, null);
  assert.ok(row.last_seen_at, "last_seen_at inicializado");
  // absolute expiration ~30d desde created_at
  const ttlMs = new Date(row.expires_at) - new Date(row.created_at);
  assert.equal(ttlMs, SESSION_TTL_SECONDS * 1000);
});

test("CREACIÓN: cookie __Host- con flags HttpOnly/Secure/SameSite=Lax/Path=/, sin Domain", async () => {
  const env = makeEnv();
  const { cookie, token } = await createSession(env, ACCOUNT_A, {});

  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=${token}`), "valor = token opaco solamente");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    assert.ok(cookie.includes(flag), `cookie incluye ${flag}`);
  }
  assert.ok(!/Domain=/i.test(cookie), "__Host- prohíbe Domain");
  assert.ok(SESSION_COOKIE_NAME.startsWith("__Host-"));
  // La cookie no transporta account_id, JSON, ni PII
  const value = cookie.split(";")[0].split("=")[1];
  assert.equal(value, token);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
});

test("CREACIÓN: límite de concurrencia — la 6ª sesión revoca la más antigua", async () => {
  const env = makeEnv();
  const tokens = [];
  for (let i = 0; i < 6; i++) {
    tokens.push((await createSession(env, ACCOUNT_A, {})).token);
  }
  const active = env.state.sessions.filter(s => s.revoked_at === null);
  assert.equal(active.length, 5, "máximo 5 sesiones activas");
  const oldestHash = await sha256Hex(tokens[0]);
  const oldest = env.state.sessions.find(s => s.token_hash === oldestHash);
  assert.ok(oldest.revoked_at, "la primera sesión quedó revocada");
});

/* =========================================================
   SESSION VALIDATION — §7, §8, §9, §18, §20
========================================================= */

test("VALIDACIÓN: sesión válida → contexto { authenticated, accountId, sessionId } sin secretos", async () => {
  const env = makeEnv();
  const { token, sessionId } = await createSession(env, ACCOUNT_A, {});
  const s = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);

  assert.equal(s.authenticated, true);
  assert.equal(s.accountId, ACCOUNT_A);
  assert.equal(s.sessionId, sessionId);
  assert.deepEqual(Object.keys(s).sort(), ["accountId", "authenticated", "sessionId"]);
  assert.ok(!("token" in s) && !("token_hash" in s) && !("password" in s) && !("roles" in s));
});

test("VALIDACIÓN: cookie ausente → no autenticado", async () => {
  const env = makeEnv();
  const s = await getAuthenticatedSession(req("/"), env);
  assert.equal(s.authenticated, false);
  assert.equal(s.accountId, null);
});

test("VALIDACIÓN: token inválido (no existe en D1) → no autenticado, indistinguible", async () => {
  const env = makeEnv();
  const s = await getAuthenticatedSession(
    req("/", { headers: { Cookie: cookieHeader(generateSessionToken()) } }), env);
  assert.equal(s.authenticated, false);
});

test("VALIDACIÓN: sesión expirada (absolute) → no autenticado", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  env.state.sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const s = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.equal(s.authenticated, false);
});

test("VALIDACIÓN: sesión revocada → no autenticado", async () => {
  const env = makeEnv();
  const { token, sessionId } = await createSession(env, ACCOUNT_A, {});
  await revokeSession(env, sessionId);
  const s = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.equal(s.authenticated, false);
});

test("VALIDACIÓN: cuenta suspended o deleted → no autenticado", async () => {
  for (const status of ["suspended", "deleted"]) {
    const env = makeEnv([{ id: ACCOUNT_A, status, security_stamp: "stamp-a" }]);
    const { token } = await createSession(env, ACCOUNT_A, {});
    const s = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);
    assert.equal(s.authenticated, false, `status=${status}`);
  }
});

test("VALIDACIÓN: security_stamp — mismatch solo si el cliente lo presenta; omitirlo no invalida", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const ok = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.equal(ok.authenticated, true, "sin stamp → válido (web simple)");

  const stale = await getAuthenticatedSession(
    req("/", { headers: { Cookie: cookieHeader(token), "X-Security-Stamp": "stamp-viejo" } }), env);
  assert.equal(stale.authenticated, false, "stamp desactualizado → inválido");

  const current = await getAuthenticatedSession(
    req("/", { headers: { Cookie: cookieHeader(token), "X-Security-Stamp": "stamp-a" } }), env);
  assert.equal(current.authenticated, true, "stamp vigente → válido");
});

test("VALIDACIÓN: cookies duplicadas — itera candidatos, token malo seguido de bueno", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const dup = `${SESSION_COOKIE_NAME}=${generateSessionToken()}; ${SESSION_COOKIE_NAME}=${token}`;
  const s = await getAuthenticatedSession(req("/", { headers: { Cookie: dup } }), env);
  assert.equal(s.authenticated, true);
});

test("VALIDACIÓN: last_seen_at rolling con throttle (no escribe en cada request)", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const request = req("/", { headers: { Cookie: cookieHeader(token) } });
  const t0 = new Date();
  const initial = env.state.sessions[0].last_seen_at;

  await getAuthenticatedSession(request, env, null, new Date(t0.getTime() + 60_000)); // +1min
  assert.equal(env.state.sessions[0].last_seen_at, initial, "dentro del throttle no reescribe");

  await getAuthenticatedSession(request, env, null, new Date(t0.getTime() + 20 * 60_000)); // +20min
  assert.notEqual(env.state.sessions[0].last_seen_at, initial, "pasado el throttle actualiza");
});

test("VALIDACIÓN: ctx.waitUntil recibe la actualización de last_seen", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const waited = [];
  const ctx = { waitUntil: p => waited.push(p) };
  await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(token) } }), env, ctx,
    new Date(Date.now() + 20 * 60_000));
  assert.equal(waited.length, 1);
  await waited[0];
});

/* =========================================================
   CONSTANT-TIME / PARSER — §8
========================================================= */

test("PARSER: solo acepta nombre exacto y valor token 43 chars base64url", () => {
  assert.deepEqual(parseSessionTokens(req("/")), []);
  assert.deepEqual(parseSessionTokens(req("/", { headers: { Cookie: "__Host-session=corto" } })), []);
  assert.deepEqual(parseSessionTokens(req("/", { headers: { Cookie: "Host-session=" + "a".repeat(43) } })), []);
  assert.deepEqual(parseSessionTokens(req("/", { headers: { Cookie: "__Host-session=" + "a".repeat(43) + "!" } })), []);
  assert.deepEqual(
    parseSessionTokens(req("/", { headers: { Cookie: cookieHeader("a".repeat(43)) } })),
    ["a".repeat(43)]);
});

/* =========================================================
   REVOCATION — §10
========================================================= */

test("REVOCACIÓN: revokeSession marca revoked_at (no borra la fila → audit)", async () => {
  const env = makeEnv();
  const { sessionId } = await createSession(env, ACCOUNT_A, {});
  await revokeSession(env, sessionId);
  const row = env.state.sessions[0];
  assert.ok(row.revoked_at, "revoked_at establecido");
  assert.equal(env.state.sessions.length, 1, "fila preservada");
});

test("REVOCACIÓN: revokeAllSessions invalida todas las sesiones de la cuenta", async () => {
  const env = makeEnv();
  const t1 = (await createSession(env, ACCOUNT_A, {})).token;
  const t2 = (await createSession(env, ACCOUNT_A, {})).token;
  await revokeAllSessions(env, ACCOUNT_A);

  for (const t of [t1, t2]) {
    const s = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(t) } }), env);
    assert.equal(s.authenticated, false);
  }
  assert.equal(env.state.sessions.filter(s => s.revoked_at === null).length, 0);
});

test("REVOCACIÓN: revokeAllSessions no toca sesiones de otras cuentas", async () => {
  const env = makeEnv([
    { id: ACCOUNT_A, status: "active", security_stamp: "stamp-a" },
    { id: ACCOUNT_B, status: "active", security_stamp: "stamp-b" },
  ]);
  const tA = (await createSession(env, ACCOUNT_A, {})).token;
  const tB = (await createSession(env, ACCOUNT_B, {})).token;
  await revokeAllSessions(env, ACCOUNT_A);

  assert.equal((await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(tA) } }), env)).authenticated, false);
  assert.equal((await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(tB) } }), env)).authenticated, true);
});

/* =========================================================
   ROTATION — §12, §13 (fixation), replay
========================================================= */

test("ROTACIÓN: token nuevo válido, token viejo inválido, sesión vieja revocada", async () => {
  const env = makeEnv();
  const old = await createSession(env, ACCOUNT_A, {});
  const rotated = await rotateSession(req("/", { headers: { Cookie: cookieHeader(old.token) } }), env);

  assert.ok(rotated, "rotación devuelve nueva sesión");
  assert.notEqual(rotated.token, old.token);
  assert.equal(rotated.accountId, ACCOUNT_A);
  assert.equal(rotated.previousSessionId, old.sessionId);

  const oldCheck = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(old.token) } }), env);
  assert.equal(oldCheck.authenticated, false, "token viejo inutilizable (replay)");

  const newCheck = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(rotated.token) } }), env);
  assert.equal(newCheck.authenticated, true);
  assert.equal(newCheck.sessionId, rotated.sessionId);
});

test("ROTACIÓN: replay del token anterior tras rotación sigue inválido", async () => {
  const env = makeEnv();
  const old = await createSession(env, ACCOUNT_A, {});
  await rotateSession(req("/", { headers: { Cookie: cookieHeader(old.token) } }), env);
  // Un atacante reintenta el token robado tras la rotación
  const replay = await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(old.token) } }), env);
  assert.equal(replay.authenticated, false);
});

test("ROTACIÓN: sin sesión válida → null (no crea nada)", async () => {
  const env = makeEnv();
  const res = await rotateSession(req("/", { headers: { Cookie: cookieHeader(generateSessionToken()) } }), env);
  assert.equal(res, null);
  assert.equal(env.state.sessions.length, 0);
});

test("FIXATION: createSession jamás reutiliza un token entregado por el cliente", async () => {
  const env = makeEnv();
  const attackerToken = generateSessionToken();
  const { token } = await createSession(env, ACCOUNT_A, {});
  assert.notEqual(token, attackerToken);
  // No existe ninguna API que acepte un session id externo: los ids se generan internamente
  assert.notEqual(env.state.sessions[0].token_hash, await sha256Hex(attackerToken));
});

/* =========================================================
   MULTI SESSION / LOGOUT replay — §11
========================================================= */

test("MULTI-SESIÓN: logout del dispositivo B no afecta al dispositivo A", async () => {
  const env = makeEnv();
  const deviceA = await createSession(env, ACCOUNT_A, {});
  const deviceB = await createSession(env, ACCOUNT_A, {});

  await destroySession(req("/", { headers: { Cookie: cookieHeader(deviceB.token) } }), env);

  assert.equal((await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(deviceA.token) } }), env)).authenticated, true);
  assert.equal((await getAuthenticatedSession(req("/", { headers: { Cookie: cookieHeader(deviceB.token) } }), env)).authenticated, false);
});

test("LOGOUT: destroySession revoca y siempre emite cookie de limpieza", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const { cookie } = await destroySession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);

  assert.ok(env.state.sessions[0].revoked_at, "sesión revocada");
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=;`), "cookie vaciada");
  assert.ok(cookie.includes("Expires=Thu, 01 Jan 1970"), "expirada en el pasado");
  assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax"));
});

test("LOGOUT: seguro ante cookie inexistente, inválida, revocada o expirada (uniforme)", async () => {
  const env = makeEnv();
  const { token, sessionId } = await createSession(env, ACCOUNT_A, {});

  for (const headers of [
    {},
    { Cookie: cookieHeader(generateSessionToken()) },
    { Cookie: "__Host-session=basura" },
  ]) {
    const { cookie } = await destroySession(req("/", { headers }), env);
    assert.ok(cookie.includes("Expires=Thu, 01 Jan 1970"), "siempre limpia cookie");
  }

  // Sesión ya revocada: segundo logout no falla
  await revokeSession(env, sessionId);
  const again = await destroySession(req("/", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.ok(again.cookie);
});

/* =========================================================
   CSRF — §14
========================================================= */

test("CSRF: allowlist estricta de Origin; null string rechazado; ausente aceptado", () => {
  const allowed = BASE;
  assert.equal(isStateChangingAllowed(req("/", { method: "POST", headers: { Origin: BASE } }), allowed), true);
  assert.equal(isStateChangingAllowed(req("/", { method: "POST", headers: { Origin: "https://evil.example" } }), allowed), false);
  assert.equal(isStateChangingAllowed(req("/", { method: "POST", headers: { Origin: "null" } }), allowed), false);
  assert.equal(isStateChangingAllowed(req("/", { method: "POST" }), allowed), true, "sin Origin: same-origin implícito");
  assert.equal(isStateChangingAllowed(req("/", { method: "POST", headers: { Origin: BASE + ".evil.example" } }), allowed), false, "sufijo engañoso");
});

/* =========================================================
   ENDPOINTS vía worker.fetch — §11, §21, §23, §26, §27
========================================================= */

test("ENDPOINT /api/session/status: sin cookie → { authenticated:false }, no-store", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/session/status"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authenticated: false });
  const cc = res.headers.get("Cache-Control");
  assert.ok(cc.includes("no-store"), "respuesta autenticada nunca cacheable");
});

test("ENDPOINT /api/session/status: con sesión válida → mínimo, sin token ni hash ni email", async () => {
  const env = makeEnv();
  const { token, sessionId } = await createSession(env, ACCOUNT_A, {});
  const res = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookieHeader(token) } }), env);
  const body = await res.json();

  assert.deepEqual(body, { authenticated: true, accountId: ACCOUNT_A });
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes(token), "token nunca en respuesta");
  assert.ok(!raw.includes(await sha256Hex(token)), "hash nunca en respuesta");
  assert.ok(!raw.includes("stamp-a"), "security_stamp nunca en respuesta");
  assert.ok(!raw.includes(sessionId), "sessionId interno no se expone");
});

test("ENDPOINT /api/session/status: respuesta uniforme ante token desconocido (anti-enumeración)", async () => {
  const env = makeEnv();
  const r1 = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookieHeader(generateSessionToken()) } }), env);
  const r2 = await worker.fetch(req("/api/session/status"), env);
  assert.equal(r1.status, r2.status);
  assert.deepEqual(await r1.json(), await r2.json());
});

test("ENDPOINT /api/session/logout: revoca, limpia cookie, no-store; replay seguro", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});

  const res = await worker.fetch(req("/api/session/logout", {
    method: "POST",
    headers: { Origin: BASE, Cookie: cookieHeader(token) },
  }), env);
  assert.equal(res.status, 200);
  const cookie = res.headers.get("Set-Cookie");
  assert.ok(cookie.includes(`${SESSION_COOKIE_NAME}=;`), "Set-Cookie limpia");
  assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax") && cookie.includes("Path=/"));
  assert.ok(res.headers.get("Cache-Control").includes("no-store"));
  assert.equal(env.state.sessions[0].revoked_at !== null, true, "sesión revocada en D1");

  // Replay del mismo token: inválido
  const after = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.deepEqual(await after.json(), { authenticated: false });

  // Segundo logout (replay de logout): 200, misma limpieza, sin errores
  const replay = await worker.fetch(req("/api/session/logout", {
    method: "POST", headers: { Origin: BASE, Cookie: cookieHeader(token) },
  }), env);
  assert.equal(replay.status, 200);
  assert.ok(replay.headers.get("Set-Cookie").includes("Expires=Thu, 01 Jan 1970"));
});

test("ENDPOINT /api/session/logout: CSRF — Origin malo 403, null 403, ausente 200, bueno 200", async () => {
  const cases = [
    [{ Origin: "https://evil.example" }, 403],
    [{ Origin: "null" }, 403],
    [{}, 200],
    [{ Origin: BASE }, 200],
  ];
  for (const [headers, expected] of cases) {
    const env = makeEnv();
    const res = await worker.fetch(req("/api/session/logout", { method: "POST", headers }), env);
    assert.equal(res.status, expected, JSON.stringify(headers));
    if (expected === 403) {
      assert.equal(env.state.sessions.length, 0, "403 no toca nada");
    }
  }
});

test("ENDPOINT /api/session/logout: CSRF 403 NO revoca la sesión", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const res = await worker.fetch(req("/api/session/logout", {
    method: "POST",
    headers: { Origin: "https://evil.example", Cookie: cookieHeader(token) },
  }), env);
  assert.equal(res.status, 403);
  assert.equal(env.state.sessions[0].revoked_at, null, "sesión intacta");
});

test("ENDPOINT /api/session/*: CORS credentials solo en session, nunca wildcard, disallowed sin headers", async () => {
  const env = makeEnv();

  const good = await worker.fetch(req("/api/session/status", { headers: { Origin: BASE } }), env);
  assert.equal(good.headers.get("Access-Control-Allow-Origin"), BASE);
  assert.equal(good.headers.get("Access-Control-Allow-Credentials"), "true");

  const evil = await worker.fetch(req("/api/session/status", { headers: { Origin: "https://evil.example" } }), env);
  assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(evil.headers.get("Access-Control-Allow-Credentials"), null);

  // Otras rutas públicas NO anuncian credenciales aunque el origen sea válido
  const props = await worker.fetch(req("/api/config", { headers: { Origin: BASE } }), env);
  assert.equal(props.headers.get("Access-Control-Allow-Origin"), BASE);
  assert.equal(props.headers.get("Access-Control-Allow-Credentials"), null);

  // Preflight: origin permitido en session → credenciales anunciadas
  const pre = await worker.fetch(req("/api/session/logout", { method: "OPTIONS", headers: { Origin: BASE } }), env);
  assert.equal(pre.headers.get("Access-Control-Allow-Credentials"), "true");
  // Preflight desde origen no permitido → sin CORS
  const preBad = await worker.fetch(req("/api/session/logout", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(preBad.headers.get("Access-Control-Allow-Origin"), null);
});

test("ENDPOINT /api/session/*: rate limiting integrado (mismo sistema, sin sistema paralelo)", async () => {
  const env = makeEnv();
  // Fuerza el límite en el fake D1
  const origPrepare = env.DB.prepare;
  env.DB.prepare = sql => {
    const st = origPrepare(sql);
    const origFirst = st.first.bind(st);
    st.first = async () => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.startsWith("SELECT requests")) return { requests: 999, expiry: Math.floor(Date.now() / 1000) + 30 };
      return origFirst();
    };
    return st;
  };
  const status = await worker.fetch(req("/api/session/status"), env);
  assert.equal(status.status, 429);
  assert.ok(status.headers.get("Retry-After"));
  const logout = await worker.fetch(req("/api/session/logout", { method: "POST", headers: { Origin: BASE } }), env);
  assert.equal(logout.status, 429);
});

test("ENDPOINT /api/session/status: método incorrecto no aplica (POST → 404)", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/session/status", { method: "POST", headers: jsonHeaders({ Origin: BASE }) }), env);
  assert.equal(res.status, 404);
});

/* =========================================================
   SEGURIDAD TRANSVERSAL — §30 SECURITY
========================================================= */

test("SEGURIDAD: token jamás aparece en respuestas de API ni se loguea", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});

  const logs = [];
  const origErr = console.error, origLog = console.log;
  console.error = (...a) => logs.push(a.join(" "));
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const st = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookieHeader(token) } }), env);
    const lo = await worker.fetch(req("/api/session/logout", { method: "POST", headers: { Origin: BASE, Cookie: cookieHeader(token) } }), env);
    assert.ok(!(await st.text()).includes(token));
    assert.ok(!(await lo.text()).includes(token));
  } finally {
    console.error = origErr; console.log = origLog;
  }
  assert.ok(!logs.join("\n").includes(token), "logs limpios");
});

test("SEGURIDAD: respuestas de sesión llevan no-store + baseline headers (sin cache leakage)", async () => {
  const env = makeEnv();
  const { token } = await createSession(env, ACCOUNT_A, {});
  const res = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookieHeader(token) } }), env);
  assert.ok(res.headers.get("Cache-Control").includes("no-store"));
  assert.ok(res.headers.get("Cache-Control").includes("no-cache"));
  assert.ok(res.headers.get("Content-Security-Policy"), "baseline 04.2.1 intacta");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
});

test("SEGURIDAD: admin separation — cookie de sesión de usuario NO autentica rutas admin", async () => {
  const env = makeEnv();
  env.ADMIN_TOKEN = "admin-secret";
  const { token } = await createSession(env, ACCOUNT_A, {});
  const res = await worker.fetch(req("/api/admin/properties", {
    headers: { Cookie: cookieHeader(token) },
  }), env);
  assert.equal(res.status, 401, "sesión de usuario no es admin");
});

test("SEGURIDAD: cookie de sesión no confunde al admin (Bearer sigue siendo la vía admin)", async () => {
  const env = makeEnv();
  env.ADMIN_TOKEN = "admin-secret";
  const { token } = await createSession(env, ACCOUNT_A, {});
  const res = await worker.fetch(req("/api/admin/properties", {
    headers: { Cookie: cookieHeader(token), Authorization: "Bearer admin-secret" },
  }), env);
  assert.notEqual(res.status, 401, "Bearer admin sigue funcionando con cookie presente");
});
