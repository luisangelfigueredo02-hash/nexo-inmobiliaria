import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";


/* =========================================================
   Mocks de entorno Cloudflare
========================================================= */

const ROWS = [
  {
    id: 1,
    property_type: "Casa",
    title: "Casa en El Vedado",
    province: "La Habana",
    city: "La Habana",
    neighborhood: "Vedado",
    latitude: 23.1,
    longitude: -82.4,
    bedrooms: 3,
    bathrooms: 2,
    square_meters: 120,
    price: 50000,
    description: "Casa amplia con portal amplio.",
    photos: '["https://ejemplo.com/1.jpg"]',
    owner_name: "Propietario Privado",
    owner_phone: "555-111",
    contact_email: "privado@ejemplo.cu",
    notes: "Notas internas",
    status: "available",
    created_at: "2026-08-01"
  }
];


function makeEnv() {
  return {
    ADMIN_PASSWORD: "secreto-test",
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() { return { results: ROWS }; },
          async first() { return ROWS[0]; },
          async run() {
            return { meta: { last_row_id: 42 } };
          }
        };
      }
    },
    AI: {
      async run() {
        return { response: "respuesta-ia" };
      }
    }
  };
}


const BASE = "https://nexo.test";


function req(path, init = {}) {
  return new Request(BASE + path, init);
}


/* =========================================================
   HEALTH
========================================================= */

test("health devuelve ok", async () => {
  const res = await worker.fetch(
    req("/api/health"),
    makeEnv()
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});


/* =========================================================
   PROPIEDADES PÚBLICAS
========================================================= */

test("catálogo público sin datos privados", async () => {
  const res = await worker.fetch(
    req("/api/properties"),
    makeEnv()
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.properties.length, 1);

  const prop = data.properties[0];

  assert.ok("price" in prop);
  assert.ok("title" in prop);

  // CAMPO PRIVADO nunca debe salir sin sesión admin:
  assert.ok(!("owner_name" in prop));
  assert.ok(!("owner_phone" in prop));
  assert.ok(!("contact_email" in prop));
  assert.ok(!("notes" in prop));
  assert.ok(!("address" in prop));
});


test("id inválido → 400", async () => {
  const res = await worker.fetch(
    req("/api/properties/abc"),
    makeEnv()
  );

  assert.equal(res.status, 400);
});


test("detalle público sin datos privados", async () => {
  const res = await worker.fetch(
    req("/api/properties/1"),
    makeEnv()
  );

  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(!("owner_name" in data.property));
  assert.ok(!("address" in data.property));
});


/* =========================================================
   AUTORIZACIÓN
========================================================= */

test("POST /api/properties sin sesión → 401", async () => {
  const res = await worker.fetch(
    req("/api/properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" })
    }),
    makeEnv()
  );

  assert.equal(res.status, 401);
});


test("login contraseña incorrecta → 401", async () => {
  const res = await worker.fetch(
    req("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "malo" })
    }),
    makeEnv()
  );

  assert.equal(res.status, 401);
});


test("login contraseña correcta → 200 + cookie", async () => {
  const res = await worker.fetch(
    req("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secreto-test" })
    }),
    makeEnv()
  );

  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie") || "";
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite"));
});


test("rate limit de login → 429", async () => {
  const env = makeEnv();
  let status = 0;

  for (let i = 0; i < 12; i++) {
    const res = await worker.fetch(
      req("/api/admin/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "CF-Connecting-IP": "1.2.3.4"
        },
        body: JSON.stringify({ password: "intento" + i })
      }),
      env
    );

    status = res.status;
  }

  assert.equal(status, 429);
});


/* =========================================================
   PAYLOAD / VALIDACIONES
========================================================= */

test("payload demasiado grande → 413", async () => {
  const res = await worker.fetch(
    req("/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(128 * 1024)
      },
      body: JSON.stringify({ message: "x" })
    }),
    makeEnv()
  );

  assert.equal(res.status, 413);
});


test("JSON inválido en búsqueda → 400", async () => {
  const res = await worker.fetch(
    req("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "no-es-json"
    }),
    makeEnv()
  );

  assert.equal(res.status, 400);
});


test("mensaje IA excesivamente largo → 400", async () => {
  const res = await worker.fetch(
    req("/api/ia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(5000) })
    }),
    makeEnv()
  );

  assert.equal(res.status, 400);
});


/* =========================================================
   CORS
========================================================= */

test("origin externo → sin cabeceras CORS", async () => {
  const res = await worker.fetch(
    req("/api/health", {
      headers: { Origin: "https://frikiego.evil.com" }
    }),
    makeEnv()
  );

  assert.equal(
    res.headers.get("access-control-allow-origin"),
    null
  );
});


test("origin same-host → reflejado", async () => {
  const res = await worker.fetch(
    req("/api/health", {
      headers: { Origin: "https://nexo.test" }
    }),
    makeEnv()
  );

  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "https://nexo.test"
  );
});


/* =========================================================
   ROUTER / SEGURIDAD HEADERS
========================================================= */

test("endpoint desconocido → 404", async () => {
  const res = await worker.fetch(
    req("/api/nope"),
    makeEnv()
  );

  assert.equal(res.status, 404);
});


test("cabeceras de seguridad presentes en JSON", async () => {
  const res = await worker.fetch(
    req("/api/health"),
    makeEnv()
  );

  assert.equal(
    res.headers.get("x-content-type-options"),
    "nosniff"
  );
  assert.ok(
    res.headers.get("content-security-policy")
  );
  assert.equal(
    res.headers.get("x-frame-options"),
    "DENY"
  );
});


/* =========================================================
   TRUST SYSTEM — quality score (P0)
========================================================= */

test("quality score se deriva de campos reales", async () => {
  const res = await worker.fetch(
    req("/api/properties"),
    makeEnv()
  );

  const data = await res.json();
  const quality =
    data.properties[0].quality;

  assert.ok(quality);
  assert.ok(
    quality.score > 0 &&
      quality.score <= 100
  );
  assert.ok(
    Array.isArray(quality.flags)
  );
});


/* =========================================================
   SEO — sitemap + robots (P0)
========================================================= */

test("sitemap.xml es XML válido con URLs reales", async () => {
  const res = await worker.fetch(
    req("/sitemap.xml"),
    makeEnv()
  );

  assert.equal(res.status, 200);
  const text = await res.text();

  assert.ok(
    text.includes(
      "<urlset xmlns="
    )
  );
  assert.ok(
    text.includes(
      "/propiedad/1"
    )
  );
  assert.equal(
    res.headers.get("content-type")
    ,
    "application/xml; charset=utf-8"
  );
});


test("robots.txt enlaza el sitemap", async () => {
  const res = await worker.fetch(
    req("/robots.txt"),
    makeEnv()
  );

  assert.equal(res.status, 200);
  const text = await res.text();

  assert.ok(
    text.includes(
      "Sitemap: https://nexo.test/sitemap.xml"
    )
  );
});


/* =========================================================
   ANALYTICS (P2)
========================================================= */

test("métrica válida se acepta", async () => {
  const res = await worker.fetch(
    req("/api/metrics/track", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body:
        JSON.stringify({
          kind:
            "contact_open"
        })
    }),
    makeEnv()
  );

  assert.equal(res.status, 200);
});

test("métrica inválida → 400", async () => {
  const res = await worker.fetch(
    req("/api/metrics/track", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body:
        JSON.stringify({
          kind:
            "no_permitido"
        })
    }),
    makeEnv()
  );

  assert.equal(res.status, 400);
});

test("GET /api/metrics sin auth → 401", async () => {
  const res = await worker.fetch(
    req("/api/metrics"),
    makeEnv()
  );

  assert.equal(
    res.status,
    401
  );
});


/* =========================================================
   IMAGE PROXY (P2)
========================================================= */

test("proxy de imágenes rechaza host no autorizado", async () => {
  const res = await worker.fetch(
    req(
      "/api/images?url=" +
        encodeURIComponent(
          "https://example.com/x.jpg"
        )
    ),
    makeEnv()
  );

  assert.equal(
    res.status,
    403
  );
});
