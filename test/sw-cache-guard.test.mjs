import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW = readFileSync(join(ROOT, "public", "sw.js"), "utf8");

/* Evalúa la política de exclusión replicando la condición de sw.js
   (fuente de verdad) como predicado puro. */
const EXCLUDED_PREFIXES = ["/api/admin/", "/api/session/", "/api/auth/", "/api/me/"];
function isExcluded(request, url) {
  return (
    request.method !== "GET" ||
    EXCLUDED_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
    url.pathname === "/admin.html"
  );
}

// Guard anti-drift: sw.js debe contener cada prefijo excluido.
test("sw.js excluye todos los prefijos autenticados (anti-drift)", () => {
  for (const p of [...EXCLUDED_PREFIXES, '"/admin.html"']) {
    assert.ok(SW.includes(p), `sw.js debe contener ${p}`);
  }
});
const req = (path, method = "GET") => ({
  request: { method },
  url: new URL(`https://nexo.dev${path}`)
});

test("SW nunca cachea endpoints autenticados", () => {
  for (const p of [
    "/api/me/favorites",
    "/api/me/favorites/N-001",
    "/api/session/status",
    "/api/session/logout",
    "/api/auth/login",
    "/api/auth/register",
    "/api/admin/properties",
    "/admin.html"
  ]) {
    const { request, url } = req(p);
    assert.ok(isExcluded(request, url), `${p} debe estar excluido del cache SW`);
  }
});

test("SW sí puede cachear rutas públicas GET", () => {
  for (const p of ["/api/properties", "/api/config", "/", "/mapa/", "/media/n001/photo-01.jpg"]) {
    const { request, url } = req(p);
    assert.ok(!isExcluded(request, url), `${p} no debe estar excluido`);
  }
});

test("SW nunca cachea métodos que mutan estado", () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const { request, url } = req("/api/properties", method);
    assert.ok(isExcluded(request, url), `${method} debe estar excluido`);
  }
});

test("SW version bumped tras el fix de cache privado", () => {
  assert.ok(!SW.includes("nexo-v7-map-assets"), "versión antigua debe rotarse");
  assert.ok(/SW_VERSION = "nexo-v\d+-/.test(SW), "SW_VERSION con formato esperado");
});
