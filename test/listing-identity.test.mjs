import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../worker.js";


/* =========================================================
   04.4.1 — CANONICAL LISTING IDENTITY tests.
   Modelo: properties.id INTEGER (interno, relaciones) +
   public_code TEXT NOT NULL UNIQUE (público, URLs/SEO/IA).
   Resolución dual por patrón: 'N-XXX' → public_code;
   numérico → id interno (compatibilidad legacy).
========================================================= */

const BASE = "https://nexo-inmueble.example.workers.dev";
const ADMIN = "admin-secret";

const ROW = {
  id: 9,
  public_code: "N-001",
  title: "Apartamento en La Coronela",
  type: "Apartamento",
  operation: "venta",
  price: 10500,
  province: "La Habana",
  city: "La Lisa",
  neighborhood: "La Coronela",
  bedrooms: 2,
  bathrooms: 1,
  area: null,
  description: "Descripción de prueba",
  images: '["/media/n001/photo-01.jpg"]',
  latitude: null,
  longitude: null,
  status: "published",
  created_at: "2026-08-19"
};

function req(path, init = {}) {
  return new Request(BASE + path, init);
}

// Fake D1 con captura de SQL, batch() y vector ops
function makeEnv({ rows = [ROW], seqValue = 1 } = {}) {
  const captured = [];
  const vectorOps = [];
  const state = { rows: [...rows], seq: seqValue };

  const statement = sql => {
    const call = { sql, binds: [] };
    captured.push(call);
    return {
      _sql: sql,
      bind(...args) { call.binds = args; return this; },
      async all() { return { results: [...state.rows] }; },
      async first() {
        if (/SELECT requests/i.test(sql)) return null; // rate limit
        if (/INSERT INTO properties/i.test(sql)) {
          // Tras el UPDATE de la secuencia (batch), state.seq ya es el valor nuevo
          return { id: 42, public_code: `N-${String(state.seq).padStart(3, "0")}` };
        }
        // Resolución dual: última columna del WHERE contra el bind
        if (/WHERE public_code = \?/i.test(sql)) {
          return state.rows.find(r => r.public_code === call.binds[call.binds.length - 1]) || null;
        }
        if (/WHERE id = \?/i.test(sql)) {
          const id = call.binds[call.binds.length - 1];
          return state.rows.find(r => String(r.id) === String(id)) || null;
        }
        return state.rows[0] || null;
      },
      async run() {
        if (/UPDATE listing_id_sequence/i.test(sql)) state.seq++;
        if (/INSERT INTO rate_limits|DELETE FROM rate_limits/i.test(sql)) return { meta: { changes: 0 } };
        return { meta: { changes: 1 } };
      }
    };
  };

  return {
    captured, vectorOps, state,
    env: {
      DB: {
        prepare: statement,
        async batch(stmts) {
          const out = [];
          for (const st of stmts) {
            if (/RETURNING/i.test(st._sql)) out.push({ results: [await st.first()] });
            else { await st.run(); out.push({ results: [] }); }
          }
          return out;
        }
      },
      ADMIN_TOKEN: ADMIN,
      VECTOR_INDEX: {
        async upsert(v) { vectorOps.push({ op: "upsert", id: v[0].id }); },
        async deleteByIds(ids) { vectorOps.push({ op: "delete", id: ids[0] }); }
      },
      AI: {
        async run() { return { data: [[0.1, 0.2]], response: "respuesta IA" }; }
      }
    }
  };
}

const adminHeaders = (extra = {}) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${ADMIN}`,
  ...extra
});

const NEW_PROP = {
  title: "Casa nueva", type: "casa", operation: "venta", price: 30000,
  province: "La Habana", city: "Playa", neighborhood: "Miramar",
  bedrooms: 3, bathrooms: 2, area: 150, description: "desc"
};


/* =========================================================
   RESOLUCIÓN DUAL — §15, §16
========================================================= */

test("DETALLE: 'N-001' resuelve por public_code (columna y bind correctos)", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/properties/N-001"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.public_code, "N-001");

  const q = captured.find(c => /FROM properties WHERE public_code = \?/i.test(c.sql));
  assert.ok(q, "query usa columna public_code");
  assert.deepEqual(q.binds, ["N-001"]);
});

test("DETALLE: numérico '9' resuelve por id interno (compatibilidad legacy)", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/properties/9"), env);
  assert.equal(res.status, 200);

  const q = captured.find(c => /FROM properties WHERE id = \?/i.test(c.sql));
  assert.ok(q, "query usa columna id");
  assert.deepEqual(q.binds, ["9"]);
});

test("15A: 'D-001' (demo) resuelve por public_code — regresión P0 detalle demo 404", async () => {
  const demoRow = { ...ROW, id: 10, public_code: "D-001", title: "Casa demo" };
  const { env, captured } = makeEnv({ rows: [demoRow] });
  const res = await worker.fetch(req("/api/properties/D-001"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.public_code, "D-001");

  const q = captured.find(c => /FROM properties WHERE public_code = \?/i.test(c.sql));
  assert.ok(q, "query usa columna public_code para códigos D-");
  assert.deepEqual(q.binds, ["D-001"]);
});

test("DETALLE: public_code case-insensitive ('n-001' → 'N-001')", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/properties/n-001"), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /WHERE public_code = \?/i.test(c.sql));
  assert.deepEqual(q.binds, ["N-001"]);
});

test("DETALLE: código inexistente → 404 uniforme", async () => {
  const { env } = makeEnv();
  const res = await worker.fetch(req("/api/properties/N-999"), env);
  assert.equal(res.status, 404);
});

test("SEO /property.html?id=N-001 resuelve por public_code", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/property.html?id=N-001"), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /WHERE public_code = \?/i.test(c.sql));
  assert.ok(q, "SEO lookup por public_code");
  const html = await res.text();
  assert.ok(html.includes("Apartamento en La Coronela"), "meta SEO con datos reales");
});

test("SEO /property.html?id=9 resuelve por id interno (URL legacy preservada)", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/property.html?id=9"), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /WHERE id = \?/i.test(c.sql));
  assert.ok(q);
});

test("SIMILARES: entrada por public_code; exclusión por id interno (sin mezclar)", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/properties/N-001/similar"), env);
  assert.equal(res.status, 200);

  const lookup = captured.find(c => /WHERE public_code = \?/i.test(c.sql));
  assert.ok(lookup, "resolución inicial por public_code");
  const list = captured.filter(c => /id != \?/i.test(c.sql));
  assert.ok(list.length >= 1, "exclusión usa id interno");
  assert.equal(list[0].binds[0], 9, "id interno de la fila resuelta");
});


/* =========================================================
   EXPOSICIÓN PÚBLICA — §15, §26
========================================================= */

test("LISTA pública: incluye public_code en el SELECT", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/properties"), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /FROM properties WHERE status/i.test(c.sql));
  assert.ok(/public_code/i.test(q.sql), "public_code en SELECT público");
  const body = await res.json();
  assert.equal(body[0].public_code, "N-001");
  assert.ok(!("owner_phone" in body[0]), "whitelist pública intacta");
});

test("ADMIN lista: incluye public_code (panel muestra código público)", async () => {
  const { env, captured } = makeEnv();
  const res = await worker.fetch(req("/api/admin/properties", { headers: adminHeaders() }), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /FROM properties ORDER BY/i.test(c.sql));
  assert.ok(/public_code/i.test(q.sql));
});


/* =========================================================
   GENERACIÓN DE public_code — §6, §7 (concurrencia, deletes)
========================================================= */

test("ADMIN POST: usa listing_id_sequence (batch atómico UPDATE+INSERT)", async () => {
  const { env, captured } = makeEnv({ seqValue: 1 });
  const res = await worker.fetch(req("/api/admin/properties", {
    method: "POST", headers: adminHeaders(), body: JSON.stringify(NEW_PROP)
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.public_code, "N-002", "seq=1 → siguiente código N-002");
  assert.equal(body.id, 42);

  assert.ok(captured.some(c => /UPDATE listing_id_sequence SET value = value \+ 1/i.test(c.sql)),
    "secuencia incrementada en batch");
  assert.ok(captured.some(c => /INSERT INTO properties \(public_code/i.test(c.sql)),
    "INSERT asigna public_code, id autoincrementa");
});

test("ADMIN POST: sin batch (fallback) usa MAX(public_code) con retry", async () => {
  const { env, captured } = makeEnv();
  env.DB.batch = undefined; // schema previo a 0005
  const res = await worker.fetch(req("/api/admin/properties", {
    method: "POST", headers: adminHeaders(), body: JSON.stringify(NEW_PROP)
  }), env);
  assert.equal(res.status, 200);
  const q = captured.find(c => /MAX\(CAST\(SUBSTR\(public_code, 3\)/i.test(c.sql));
  assert.ok(q, "fallback MAX(public_code)");
  assert.ok(!captured.some(c => /UPDATE listing_id_sequence/i.test(c.sql)), "sin secuencia");
});

test("ADMIN POST: jamás genera public_code desde COUNT ni desde id interno", async () => {
  const { env, captured } = makeEnv();
  await worker.fetch(req("/api/admin/properties", {
    method: "POST", headers: adminHeaders(), body: JSON.stringify(NEW_PROP)
  }), env);
  const insert = captured.find(c => /INSERT INTO properties/i.test(c.sql));
  assert.ok(!/COUNT\(\*\)/i.test(insert.sql), "no COUNT-based (colisiona tras deletes)");
  assert.ok(!/MAX\(CAST\(SUBSTR\(id,/i.test(insert.sql), "no deriva código de la PK interna");
});


/* =========================================================
   VECTORIZE / IA — §14
========================================================= */

test("VECTORIZE: create/update/delete usan public_code como vector id", async () => {
  const { env, vectorOps } = makeEnv();
  await worker.fetch(req("/api/admin/properties", {
    method: "POST", headers: adminHeaders(), body: JSON.stringify(NEW_PROP)
  }), env);
  assert.deepEqual(vectorOps.filter(o => o.op === "upsert").map(o => o.id), ["N-002"]);

  vectorOps.length = 0;
  await worker.fetch(req("/api/admin/properties/9", {
    method: "PUT", headers: adminHeaders(), body: JSON.stringify({ ...NEW_PROP, status: "published" })
  }), env);
  assert.deepEqual(vectorOps.filter(o => o.op === "upsert").map(o => o.id), ["N-001"]);

  vectorOps.length = 0;
  await worker.fetch(req("/api/admin/properties/9", { method: "DELETE", headers: adminHeaders() }), env);
  assert.deepEqual(vectorOps.filter(o => o.op === "delete").map(o => o.id), ["N-001"]);
});

test("CHAT IA: contexto del LLM usa public_code, jamás PK interna", async () => {
  const { env } = makeEnv();
  let systemPrompt = "";
  env.AI.run = async (model, { messages }) => {
    if (messages) systemPrompt = messages[0].content;
    return { data: [[0.1]], response: "ok" };
  };
  const res = await worker.fetch(req("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "busco casa" })
  }), env);
  assert.equal(res.status, 200);
  assert.ok(systemPrompt.includes("ID: N-001"), "contexto con public_code");
  assert.ok(!systemPrompt.includes("ID: 9"), "PK interna nunca expuesta a la IA");
});


/* =========================================================
   MIGRATION 0005 — §19, §22, §25 (aserciones estáticas)
========================================================= */

const MIGRATION = readFileSync(new URL("../migrations/0005_canonical_listing_identity.sql", import.meta.url), "utf8");

test("MIGRATION 0005: public_code NOT NULL UNIQUE en el rebuild de properties", () => {
  assert.match(MIGRATION, /public_code\s+TEXT NOT NULL UNIQUE/i);
  assert.match(MIGRATION, /INSERT INTO properties_new[\s\S]*SELECT[\s\S]*FROM properties/i, "copy data antes de swap");
  assert.ok(MIGRATION.indexOf("INSERT INTO properties_new") < MIGRATION.indexOf("DROP TABLE properties"),
    "copia antes del DROP (sin pérdida)");
});

test("MIGRATION 0005: relaciones alineadas a INTEGER y FKs explícitas", () => {
  assert.match(MIGRATION, /listing_id\s+INTEGER NOT NULL REFERENCES properties\(id\) ON DELETE CASCADE/i,
    "listing_owners → properties(id) CASCADE");
  assert.match(MIGRATION, /listing_id\s+INTEGER NOT NULL/i, "moderation_events alineado INTEGER");
  assert.ok(!/REFERENCES properties\(id\)[\s\S]{0,120}moderation_events/i.test(MIGRATION),
    "moderation_events sin CASCADE destructivo (audit)");
});

test("MIGRATION 0005: secuencia delete-safe + índices recreados", () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS listing_id_sequence/i);
  assert.match(MIGRATION, /MAX\(CAST\(SUBSTR\(public_code, 3\)/i, "seed desde el máximo existente");
  for (const idx of ["idx_properties_status_created", "idx_properties_geo", "idx_properties_city",
    "idx_properties_type", "idx_properties_province", "idx_properties_price", "idx_properties_created_by",
    "idx_listing_owners_account_id", "idx_moderation_listing_id"]) {
    assert.ok(MIGRATION.includes(idx), `índice recreado: ${idx}`);
  }
});
