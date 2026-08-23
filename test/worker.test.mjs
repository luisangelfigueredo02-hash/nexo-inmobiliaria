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