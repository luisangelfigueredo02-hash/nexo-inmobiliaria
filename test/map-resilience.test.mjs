import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const MAP_PAGES = ["public/mapa/index.html", "public/index.html"];

test("14D: ambas vistas de mapa manejan tileerror con aviso visible", () => {
  for (const page of MAP_PAGES) {
    const html = read(page);
    assert.ok(html.includes("tileerror"), `${page} debe escuchar tileerror`);
    assert.ok(
      html.includes("El mapa base no está disponible"),
      `${page} debe mostrar aviso honesto cuando los tiles fallan`
    );
  }
});

test("14D: tiles usan CARTO (no OSM directo) y con attribution", () => {
  for (const page of MAP_PAGES) {
    const html = read(page);
    assert.ok(html.includes("basemaps.cartocdn.com"), `${page} usa CARTO`);
    assert.ok(!html.includes("tile.openstreetmap.org"), `${page} no usa OSM directo`);
    assert.ok(html.includes("attribution"), `${page} incluye attribution`);
  }
});

test("14D: /mapa/ tiene estados explícitos (loading watchdog, error, sin coordenadas)", () => {
  const html = read("public/mapa/index.html");
  assert.ok(html.includes("No se pudo cargar el mapa"), "watchdog de loading eterno");
  assert.ok(html.includes("showNoCoordsState"), "estado sin coordenadas");
  assert.ok(html.includes("El mapa no está disponible ahora"), "fallback de mapa no disponible");
});

test("14D: Leaflet es self-hosted con fallback CDN en ambas páginas", () => {
  for (const page of MAP_PAGES) {
    const html = read(page);
    assert.ok(html.includes("/vendor/leaflet/leaflet.js"), `${page} carga Leaflet local`);
    assert.ok(html.includes("unpkg.com/leaflet@1.9.4"), `${page} conserva fallback CDN`);
  }
});
