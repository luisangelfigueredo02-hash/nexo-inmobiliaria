import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import worker from "../worker.js";


/* =========================================================
   04.2.1 — Security Headers & CSP hash-based.
   Verifica la baseline aplicada por withSecurityHeaders en
   fetch(), las invariantes de la política CSP y la ausencia
   de drift entre worker.js y los scripts inline de public/.
========================================================= */

const BASE = "https://nexo-inmueble.example.workers.dev";

function makeEnv() {
  return {
    ADMIN_TOKEN: "test-token",
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() { return { results: [] }; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    },
    AI: { run: async () => ({ response: "ok" }) },
  };
}

function req(path, init = {}) {
  return new Request(BASE + path, init);
}

function cspSegment(csp, name) {
  return csp.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ")) || "";
}


test("GET /api/health expone la baseline completa de security headers", async () => {
  const res = await worker.fetch(req("/api/health"), makeEnv());
  assert.equal(res.status, 200);

  assert.ok(res.headers.get("Content-Security-Policy"), "CSP presente");
  assert.equal(
    res.headers.get("Strict-Transport-Security"),
    "max-age=63072000; includeSubDomains; preload"
  );
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(res.headers.get("Permissions-Policy").includes("geolocation=()"));
  assert.equal(res.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal(res.headers.get("Cache-Control"), "no-store", "API sin caché");
});

test("CSP: script-src es hash-based sin 'unsafe-inline' y declara hosts permitidos", async () => {
  const res = await worker.fetch(req("/api/health"), makeEnv());
  const csp = res.headers.get("Content-Security-Policy");

  const scriptSrc = cspSegment(csp, "script-src");
  assert.ok(scriptSrc, "script-src presente");
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src sin unsafe-inline");
  assert.ok(scriptSrc.includes("'self'"));
  assert.ok(scriptSrc.includes("https://unpkg.com"), "Leaflet permitido");
  const hashCount = (scriptSrc.match(/'sha256-[A-Za-z0-9+/=]+'/g) || []).length;
  assert.ok(hashCount >= 9, `se esperaban >= 9 hashes de scripts inline, hay ${hashCount}`);

  assert.ok(cspSegment(csp, "default-src").includes("'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("upgrade-insecure-requests"));

  // Excepción documentada: atributos style= extensos + Leaflet inline.
  assert.ok(cspSegment(csp, "style-src").includes("'unsafe-inline'"));
});

test("CSP se aplica también a la ruta SEO /property.html", async () => {
  const res = await worker.fetch(req("/property.html"), makeEnv());
  assert.equal(res.status, 200);
  const csp = res.headers.get("Content-Security-Policy");
  assert.ok(csp, "CSP presente en HTML servido por el worker");
  assert.ok(!cspSegment(csp, "script-src").includes("'unsafe-inline'"));
});

test("CORP: /media/* es embebible cross-origin, el resto same-origin", async () => {
  const env = makeEnv();
  const media = await worker.fetch(req("/media/n001/photo-01.jpg"), env);
  assert.equal(media.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");

  const other = await worker.fetch(req("/api/config"), env);
  assert.equal(other.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
});

test("Assets estáticos pasan por la baseline (fallback 404 sin ASSETS match)", async () => {
  const res = await worker.fetch(req("/index.html"), makeEnv());
  assert.equal(res.status, 404);
  assert.ok(res.headers.get("Content-Security-Policy"), "CSP incluso en 404");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
});

test("Guard anti-drift: hashes CSP de worker.js sincronizados con public/ y sin handlers inline", () => {
  // El generador falla (exit != 0) si hay drift, handlers inline o marcadores ausentes.
  const out = execFileSync("node", ["scripts/generate-csp-hashes.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  assert.ok(out.includes("OK"), out);
});
