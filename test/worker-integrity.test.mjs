import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";


/* =========================================================
   Mock de entorno Cloudflare con CAPTURA de SQL y binds.
   Determinista: las respuestas dependen de ROWS y de los
   binds capturados, sin estado global entre tests.
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
    address: "Calle 23 #123",
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
  const captured = [];
  const statement = (sql) => {
    const call = { sql, binds: [] };
    captured.push(call);
    return {
      bind(...args) { call.binds = args; return this; },
      async all() { return { results: [...ROWS] }; },
      async first() {
        // Inserciones INSERT ... RETURNING id
        if (/INSERT INTO/i.test(sql)) return { id: "N-002" };
        // Lookups con "WHERE id = ?" → resolve contra ROWS con el último bind
        if (/WHERE id = \?/.test(sql)) {
          const id = call.binds[call.binds.length - 1];
          return ROWS.find(r => r.id === id) || null;
        }
        return ROWS[0] || null;
      },
      async run() { return { meta: { changes: 1, last_row_id: 42 } }; }
    };
  };
  return {
    ADMIN_TOKEN: "secreto-test",
    DB: { prepare: (sql) => statement(sql) },
    AI: { async run() { return { response: "respuesta-ia" }; } },
    __captured: captured
  };
}


const BASE = "https://nexo.test";

function req(path, init = {}) {
  return new Request(BASE + path, init);
}

function adminHeaders() {
  return { "Authorization": "Bearer secreto-test" };
}

function adminJson(payload) {
  return { headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

const PRIVATE_COLUMNS = ["owner_name", "owner_phone", "internal_notes", "address"];
const VALID_PAYLOAD = {
  title: "Casa válida", type: "casa", operation: "venta", price: 100000,
  province: "La Habana", city: "La Habana", neighborhood: "Vedado",
  bedrooms: 2, bathrooms: 1, area: 80, description: "Desc válida"
};


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
   API PÚBLICA — M. Sin columnas privadas en el SELECT
========================================================= */

test("M. GET /api/properties: SELECT sin columnas privadas", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/properties"), env);
  assert.equal(res.status, 200);
  const sql = env.__captured[0].sql.toLowerCase();
  for (const col of PRIVATE_COLUMNS) {
    assert.ok(!sql.includes(col), `SELECT público expone ${col}`);
  }
});


test("M. GET /api/properties/:id: SELECT sin columnas privadas", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/properties/N-001"), env);
  assert.equal(res.status, 200);
  const sql = env.__captured[0].sql.toLowerCase();
  for (const col of PRIVATE_COLUMNS) {
    assert.ok(!sql.includes(col), `SELECT público (detalle) expone ${col}`);
  }
});


test("M. GET /api/properties/:id/similar: SELECT sin columnas privadas", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/properties/N-001/similar"), env);
  assert.equal(res.status, 200);
  for (const call of env.__captured) {
    const sql = call.sql.toLowerCase();
    for (const col of PRIVATE_COLUMNS) {
      assert.ok(!sql.includes(col), `SELECT público (similares) expone ${col}`);
    }
  }
});


/* =========================================================
   ADMIN — N. Sí recibe campos privados
========================================================= */

test("N. GET /api/admin/properties incluye campos privados", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/api/admin/properties", { headers: adminHeaders() }), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok("owner_name" in (data[0] || {}), "Admin debe recibir owner_name");
  assert.ok("internal_notes" in (data[0] || {}), "Admin debe recibir internal_notes");
  const sql = env.__captured[0].sql.toLowerCase();
  for (const col of PRIVATE_COLUMNS) {
    assert.ok(sql.includes(col), `SELECT admin debe incluir ${col}`);
  }
});


/* =========================================================
   VALIDACIÓN — A. POST inválido / B. PUT inválido → 400
========================================================= */

test("A. POST /api/admin/properties rechaza payload inválido", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ title: "x" }) }), makeEnv());
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("B. PUT /api/admin/properties/:id rechaza payload inválido", async () => {
  const res = await worker.fetch(req("/api/admin/properties/N-001", { method: "PUT", ...adminJson({ title: "x" }) }), makeEnv());
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});


/* =========================================================
   PUT EXISTENCIA — C. Inexistente → 404
========================================================= */

test("C. PUT /api/admin/properties/:id inexistente → 404 (no success)", async () => {
  const res = await worker.fetch(req("/api/admin/properties/N-999", { method: "PUT", ...adminJson(VALID_PAYLOAD) }), makeEnv());
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(!data.success);
  assert.ok(data.error);
});


/* =========================================================
   COORDENADAS — D/E NULL, F/G válidas, H fuera de rango
========================================================= */

function postPayloadToBinds(payload) {
  const env = makeEnv();
  return worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson(payload) }), env)
    .then(res => ({ status: res.status, env }));
}

const bindIdx = Object.freeze({ lat: 14, lng: 15 }); // posición en el INSERT

test("D. latitude ausente → persistida como NULL", async () => {
  const { status, env } = await postPayloadToBinds({ ...VALID_PAYLOAD, longitude: -80 });
  assert.equal(status, 200);
  const insert = env.__captured.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.binds[bindIdx.lat], null);
});

test("E. longitude ausente → persistida como NULL", async () => {
  const { status, env } = await postPayloadToBinds({ ...VALID_PAYLOAD, latitude: 23 });
  assert.equal(status, 200);
  const insert = env.__captured.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.binds[bindIdx.lng], null);
});

// En el INSERT los binds son:
// [0]=attempt, [1..13]=title..images, [14]=latitude, [15]=longitude, [16]=status, ...

test("D2. latitude string vacío → persistida como NULL", async () => {
  const { env } = await postPayloadToBinds({ ...VALID_PAYLOAD, latitude: "", longitude: -80 });
  const insert = env.__captured.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.binds[bindIdx.lat], null);
});

test("F. latitude válida → persistida como número", async () => {
  const { status, env } = await postPayloadToBinds({ ...VALID_PAYLOAD, latitude: 23.1136, longitude: -81.0 });
  assert.equal(status, 200);
  const insert = env.__captured.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.binds[bindIdx.lat], 23.1136);
});

test("G. longitude válida → persistida como número", async () => {
  const { status, env } = await postPayloadToBinds({ ...VALID_PAYLOAD, latitude: 23, longitude: -82.3828 });
  assert.equal(status, 200);
  const insert = env.__captured.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.binds[bindIdx.lng], -82.3828);
});

test("H. latitude fuera de rango (95) → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, latitude: 95 }) }), makeEnv());
  assert.equal(res.status, 400);
});

test("H. longitude fuera de rango (200) → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, longitude: 200 }) }), makeEnv());
  assert.equal(res.status, 400);
});


/* =========================================================
   IMÁGENES — I/J prohibidas, K/L permitidas
========================================================= */

test("I. imagen javascript: → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, images: ["javascript:alert(1)"] }) }), makeEnv());
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(/esquema prohibido|debe ser/i.test(data.error));
});

test("J. imagen data: → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, images: ["data:image/png;base64,abc"] }) }), makeEnv());
  assert.equal(res.status, 400);
});

test("K. imagen /media/* válida → 200", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, images: ["/media/n001/photo-01.jpg"] }) }), makeEnv());
  assert.equal(res.status, 200);
});

test("L. imagen https:// válida → 200", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, images: ["https://example.com/photo.jpg"] }) }), makeEnv());
  assert.equal(res.status, 200);
});


/* =========================================================
   STATUS — O. published/draft permitidos, otro → 400
========================================================= */

test("O. status published permitido", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, status: "published" }) }), makeEnv());
  assert.equal(res.status, 200);
});

test("O. status draft permitido", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, status: "draft" }) }), makeEnv());
  assert.equal(res.status, 200);
});

test("O. status arbitrario → 400", async () => {
  const res = await worker.fetch(req("/api/admin/properties", { method: "POST", ...adminJson({ ...VALID_PAYLOAD, status: "borrado" }) }), makeEnv());
  assert.equal(res.status, 400);
});
