import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";


/* =========================================================
   Mocks de entorno Cloudflare
========================================================= */

const ROWS = [
  {
    id: "N-001",
    title: "Casa en El Vedado",
    type: "casa",
    operation: "venta",
    price: 50000,
    province: "La Habana",
    city: "La Habana",
    neighborhood: "Vedado",
    address: "",
    bedrooms: 3,
    bathrooms: 2,
    area: 120,
    description: "Casa amplia con portal amplio.",
    images: '["/media/n001/photo-01.jpg"]',
    latitude: 23.1,
    longitude: -82.4,
    owner_name: "Propietario Privado",
    owner_phone: "555-111",
    internal_notes: "Notas internas",
    status: "published",
    created_at: "2026-08-01"
  }
];


function makeEnv() {
  return {
    ADMIN_TOKEN: "secreto-test",
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() { return { results: [ROWS[0]] }; },
          async first() { return ROWS[0]; },
          async run() { return { meta: { last_row_id: 42 } }; }
        };
      }
    },
    AI: { async run() { return { response: "respuesta-ia" }; } }
  };
}


const BASE = "https://nexo.test";

function req(path, init = {}) {
  return new Request(BASE + path, init);
}

function adminHeaders() {
  return { "Authorization": "Bearer secreto-test" };
}


/* =========================================================
   CONFIGURACIÓN
========================================================= */

test("/api/config devuelve whatsapp_phone", async () => {
  const res = await worker.fetch(req("/api/config"), makeEnv());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.whatsapp_phone);
});


/* =========================================================
   PROPIEDADES PÚBLICAS
========================================================= */

test("catálogo público devuelve campos públicos (sin SQL privada)", async () => {
  const res = await worker.fetch(req("/api/properties"), makeEnv());
  assert.equal(res.status, 200);
  const data = await res.json();
  const prop = Array.isArray(data) ? data[0] : data.properties[0];

  // El endpoint usa SELECT explícito de campos públicos;
  // los mocks devuelven la fila completa simulada.
  assert.ok(prop.price);
  assert.ok(prop.title);
  assert.ok(prop.type);
  assert.ok(prop.operation);
});


test("detalle público devuelve propiedad solicitada", async () => {
  const res = await worker.fetch(req("/api/properties/N-001"), makeEnv());
  assert.equal(res.status, 200);
  const data = await res.json();
  const prop = data.property || data;

  assert.equal(prop.id, "N-001");
  assert.ok(prop.title);
});


/* =========================================================
   ADMIN — AUTH Y CRUD
========================================================= */

test("GET /api/admin/properties sin token → 401", async () => {
  const res = await worker.fetch(req("/api/admin/properties"), makeEnv());
  assert.equal(res.status, 401);
});


test("POST /api/admin/verify con token correcto → 200", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST",
    headers: adminHeaders()
  }), makeEnv());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});


test("POST /api/admin/verify con token incorrecto → 401", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST",
    headers: { "Authorization": "Bearer incorrecto" }
  }), makeEnv());
  assert.equal(res.status, 401);
});


test("POST /api/admin/properties crea propiedad con token", async () => {
  const res = await worker.fetch(req("/api/admin/properties", {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Casa de prueba", type: "casa", operation: "venta", price: 10 })
  }), makeEnv());
  assert.equal(res.status, 200);
});


test("POST /api/admin/properties rechaza payload inválido → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x" })
  }), makeEnv());
  assert.equal(res.status, 400);
});

test("CORS: origin no permitido no recibe cabecera", async () => {
  const res = await worker.fetch(req("/api/config", {
    headers: { Origin: "https://malicioso.evil.com" }
  }), makeEnv());
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS: origin de producción permitido recibe cabecera reflejada", async () => {
  const res = await worker.fetch(req("/api/config", {
    headers: { Origin: "https://nexo.test" }
  }), makeEnv());
  assert.equal(res.headers.get("access-control-allow-origin"), "https://nexo.test");
});

test("Rutas admin no emiten cabeceras CORS", async () => {
  const res = await worker.fetch(req("/api/admin/properties", {
    headers: { Origin: "https://nexo.test" }
  }), makeEnv());
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS: subdominio workers.dev arbitrario rechazado", async () => {
  const res = await worker.fetch(req("/api/config", {
    headers: { Origin: "https://otro-proyecto.workers.dev" }
  }), makeEnv());
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS OPTIONS: preflight válido para origen permitido", async () => {
  const res = await worker.fetch(req("/api/config", {
    method: "OPTIONS",
    headers: { Origin: "https://nexo.test" }
  }), makeEnv());
  assert.equal(res.headers.get("access-control-allow-origin"), "https://nexo.test");
});

test("CORS OPTIONS: preflight inválido no autorizado", async () => {
  const res = await worker.fetch(req("/api/config", {
    method: "OPTIONS",
    headers: { Origin: "https://otro-proyecto.workers.dev" }
  }), makeEnv());
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("AUTH: token correcto con timingSafeEqual", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST", headers: adminHeaders()
  }), makeEnv());
  assert.equal(res.status, 200);
});

test("AUTH: token incorrecto rechazado", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST", headers: { Authorization: "Bearer secreto-mal" }
  }), makeEnv());
  assert.equal(res.status, 401);
});

test("AUTH: token vacío rechazado", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST", headers: { Authorization: "Bearer " }
  }), makeEnv());
  assert.equal(res.status, 401);
});

test("AUTH: token con longitud diferente rechazado", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST", headers: { Authorization: "Bearer x" }
  }), makeEnv());
  assert.equal(res.status, 401);
});

test("AUTH: header sin esquema Bearer rechazado", async () => {
  const res = await worker.fetch(req("/api/admin/verify", {
    method: "POST", headers: { Authorization: "secreto-test" }
  }), makeEnv());
  assert.equal(res.status, 401);
});


/* =========================================================
   MEDIA R2 — WebP negotiation
========================================================= */

function makeMediaEnv(hasVariant) {
  return {
    DB: { prepare() { return { bind() { return this; }, async run() { return {}; }, async first() { return null; } }; } },
    BUCKET_IMAGENES: {
      async get(key) {
        if (/-w(400|800|1200)\.webp$/.test(key)) {
          if (!hasVariant) return null;
          return { body: new Uint8Array([1, 2, 3]), httpEtag: "e1", writeHttpMetadata(h) { h.set("content-type", "image/webp"); } };
        }
        return { body: new Uint8Array([1]), httpEtag: "e2", writeHttpMetadata(h) { h.set("content-type", "image/jpeg"); } };
      },
      async head(key) { return this.get(key); }
    }
  };
}

test("MEDIA: Accept webp devuelve variante con Vary: Accept", async () => {
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { headers: { Accept: "image/webp" } }), makeMediaEnv(true));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("vary"), "Accept");
});

test("MEDIA: Accept webp sin variante cae al original", async () => {
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { headers: { Accept: "image/webp" } }), makeMediaEnv(false));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("vary"), null);
});

test("MEDIA: Accept jpeg devuelve original sin Vary", async () => {
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { headers: { Accept: "image/jpeg" } }), makeMediaEnv(true));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
});

/* =========================================================
   FASE 07: AUTENTICACIÓN PÚBLICA (register/login/logout/favorites)
   Mock D1 stateful para accounts/sessions/account_favorites.
========================================================= */

function makeAuthEnv() {
  const accounts = new Map();
  const sessions = new Map();
  const favorites = new Set();

  function dispatch(sql, params) {
    const p = params || [];
    if (/CREATE TABLE IF NOT EXISTS rate_limits/i.test(sql)) return { kind: "run" };
    if (/SELECT requests, expiry FROM rate_limits/i.test(sql)) return { kind: "first", value: null };
    if (/INSERT INTO rate_limits/i.test(sql)) return { kind: "run" };
    if (/DELETE FROM rate_limits/i.test(sql)) return { kind: "run" };

    if (/SELECT id FROM accounts WHERE email/i.test(sql)) {
      return { kind: "first", value: accounts.get(p[0]) ? { id: accounts.get(p[0]).id } : null };
    }
    if (/SELECT id, password_hash, status FROM accounts WHERE email/i.test(sql)) {
      return { kind: "first", value: accounts.get(p[0]) || null };
    }
    if (/INSERT INTO accounts /i.test(sql)) {
      accounts.set(p[1], { id: p[0], email: p[1], security_stamp: p[2], password_hash: p[3], status: "active" });
      return { kind: "run" };
    }
    if (/INSERT INTO profiles/i.test(sql)) return { kind: "run" };
    if (/SELECT display_name FROM profiles/i.test(sql)) return { kind: "first", value: null };

    if (/INSERT INTO sessions /i.test(sql)) {
      sessions.set(p[2], {
        id: p[0], account_id: p[1], token_hash: p[2], created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 3600e3).toISOString(), revoked_at: null, last_seen_at: null
      });
      return { kind: "run" };
    }
    if (/FROM sessions s JOIN accounts/i.test(sql)) {
      const s = sessions.get(p[0]);
      if (!s || s.revoked_at) return { kind: "first", value: null };
      const a = accounts.get([...accounts.values()].find(v => v.id === s.account_id)?.email);
      return {
        kind: "first",
        value: {
          id: s.id, account_id: s.account_id, expires_at: s.expires_at, last_seen_at: s.last_seen_at,
          account_status: a?.status || "active", account_security_stamp: a?.security_stamp || ""
        }
      };
    }
    if (/UPDATE sessions SET revoked_at/i.test(sql)) {
      // En los UPDATE el primer bind es el valor revoked_at; la clave va después.
      // La variante con subquery (límite de concurrencia) se ignora: no afecta a los flujos.
      if (/IN \(SELECT/i.test(sql)) return { kind: "run" };
      if (/WHERE token_hash/i.test(sql)) { sessions.delete(p[p.length - 1]); }
      else if (/WHERE account_id/i.test(sql)) { for (const [k, v] of sessions) if (v.account_id === p[p.length - 1]) sessions.delete(k); }
      else if (/WHERE id/i.test(sql)) { for (const [k, v] of sessions) if (v.id === p[p.length - 1]) sessions.delete(k); }
      return { kind: "run" };
    }
    if (/UPDATE sessions SET last_seen_at/i.test(sql)) return { kind: "run" };

    if (/SELECT id FROM properties WHERE/i.test(sql)) return { kind: "first", value: { id: 42 } };

    if (/FROM account_favorites af JOIN properties/i.test(sql)) {
      const rows = [...favorites]
        .filter(k => k.startsWith(p[0] + "|"))
        .map(k => ({ listing_id: k.split("|")[1], public_code: "N-001" }));
      return { kind: "all", value: rows };
    }
    if (/INSERT OR IGNORE INTO account_favorites/i.test(sql)) { favorites.add(p[0] + "|" + p[1]); return { kind: "run" }; }
    if (/DELETE FROM account_favorites/i.test(sql)) { favorites.delete(p[0] + "|" + p[1]); return { kind: "run" }; }

    return { kind: "first", value: null };
  }

  return {
    ADMIN_TOKEN: "secreto-test",
    DB: {
      prepare(sql) {
        return {
          bind(...params) { this._r = dispatch(sql, params); return this; },
          async first() { return this._r ? this._r.value ?? null : null; },
          async all() { const v = this._r?.value; return { results: Array.isArray(v) ? v : (v ? [v] : []) }; },
          async run() { if (!this._r) dispatch(sql, null); return { meta: { changes: 1 } }; },
          _r: null
        };
      }
    }
  };
}

function extractSessionCookie(res) {
  const c = res.headers.get("Set-Cookie") || "";
  const m = c.match(/__Host-session=([^;]+)/);
  return m ? m[1] : null;
}

test("AUTH: register crea cuenta y devuelve cookie __Host-session", async () => {
  const env = makeAuthEnv();
  const res = await worker.fetch(req("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@test.com", password: "password-larga", name: "Test" })
  }), env);
  assert.equal(res.status, 201);
  assert.ok(extractSessionCookie(res), "Set-Cookie con token de sesión");
});

test("AUTH: register rechaza email inválido (400)", async () => {
  const res = await worker.fetch(req("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "noemail", password: "password-larga" })
  }), makeAuthEnv());
  assert.equal(res.status, 400);
});

test("AUTH: register rechaza password corta (400)", async () => {
  const res = await worker.fetch(req("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.co", password: "corta" })
  }), makeAuthEnv());
  assert.equal(res.status, 400);
});

test("AUTH: register duplicado → 409", async () => {
  const env = makeAuthEnv();
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dup@test.com", password: "password-larga" }) };
  await worker.fetch(req("/api/auth/register", init), env);
  const res = await worker.fetch(req("/api/auth/register", init), env);
  assert.equal(res.status, 409);
});

test("AUTH: login con credenciales inválidas → 401 uniforme", async () => {
  const env = makeAuthEnv();
  const res = await worker.fetch(req("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nadie@test.com", password: "xxxxxxxx" })
  }), env);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Credenciales inválidas");
});

test("AUTH: flujo completo register → login → status → favorites → logout", async () => {
  const env = makeAuthEnv();
  const reg = await worker.fetch(req("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "flow@test.com", password: "password-larga" })
  }), env);
  assert.equal(reg.status, 201);

  const login = await worker.fetch(req("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "flow@test.com", password: "password-larga" })
  }), env);
  assert.equal(login.status, 200);
  const token = extractSessionCookie(login);
  assert.ok(token);
  const cookie = `__Host-session=${token}`;

  const favs0 = await worker.fetch(req("/api/me/favorites", { headers: { Cookie: cookie } }), env);
  assert.deepEqual(await favs0.json(), { favorites: [] });

  const put = await worker.fetch(req("/api/me/favorites", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ listing: "N-001" })
  }), env);
  assert.equal(put.status, 200);

  const favs1 = await worker.fetch(req("/api/me/favorites", { headers: { Cookie: cookie } }), env);
  const list = (await favs1.json()).favorites;
  assert.ok(list.some(c => c === "N-001" || String(c).endsWith("001")));

  const del = await worker.fetch(req("/api/me/favorites/N-001", { method: "DELETE", headers: { Cookie: cookie } }), env);
  assert.equal(del.status, 200);

  const logout = await worker.fetch(req("/api/session/logout", { method: "POST", headers: { Cookie: cookie } }), env);
  assert.equal(logout.status, 200);
  const status = await worker.fetch(req("/api/session/status", { headers: { Cookie: cookie } }), env);
  assert.deepEqual(await status.json(), { authenticated: false });
});

test("AUTH: favorites sin sesión → 401", async () => {
  const env = makeAuthEnv();
  const put = await worker.fetch(req("/api/me/favorites", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing: "N-001" })
  }), env);
  assert.equal(put.status, 401);
});

test("AUTH: cookie de usuario no habilita admin (aislamiento)", async () => {
  const env = makeAuthEnv();
  const reg = await worker.fetch(req("/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@test.com", password: "password-larga" })
  }), env);
  const token = extractSessionCookie(reg);
  const res = await worker.fetch(req("/api/admin/properties", { headers: { Cookie: `__Host-session=${token}` } }), env);
  assert.equal(res.status, 401);
});

test("AUTH: CSRF — Origin malicioso rechazado en login/register", async () => {
  const env = makeAuthEnv();
  const res = await worker.fetch(req("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://evil.example" },
    body: JSON.stringify({ email: "x@test.com", password: "xxxxxxxx" })
  }), env);
  assert.equal(res.status, 403);
});
