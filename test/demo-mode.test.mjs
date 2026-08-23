import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("14C: seed demo usa imágenes propias en /demo-media (sin fotos de terceros)", () => {
  const seed = read("scripts/seed-demo.mjs");
  assert.ok(seed.includes("/demo-media/"), "seed referencia /demo-media");
  assert.ok(!/unsplash|picsum|placehold|pexels|loremflickr/i.test(seed), "sin placeholders externos");
});

test("14C: existen los 4 SVG demo con marca de agua DEMO", () => {
  for (const t of ["casa", "apartamento", "terreno", "penthouse"]) {
    const p = join(ROOT, "public/demo-media", `${t}.svg`);
    assert.ok(existsSync(p), `falta ${t}.svg`);
    const svg = readFileSync(p, "utf8");
    assert.ok(svg.includes(">DEMO<"), `${t}.svg debe llevar marca de agua DEMO`);
  }
});

test("14C: seed genera public_code D-XXX y marca internal_notes=DEMO", () => {
  const seed = read("scripts/seed-demo.mjs");
  assert.ok(seed.includes('`D-${'), "public_code con prefijo D-");
  assert.ok(seed.includes('const MARK = "DEMO"'), "marcador DEMO");
  assert.ok(seed.includes("--clear"), "seed reversible (--clear)");
});

test("14C: seed --clear elimina solo datos demo (D-% o internal_notes=DEMO)", () => {
  const seed = read("scripts/seed-demo.mjs");
  assert.ok(
    /DELETE FROM properties WHERE internal_notes = '\$\{MARK\}' OR public_code LIKE 'D-%'/.test(seed),
    "clear acotado a datos demo, nunca borra inventario real"
  );
});

test("14C: seed generado referencia imágenes /demo-media y es SQL válido básico", () => {
  const out = execFileSync("node", [join(ROOT, "scripts/seed-demo.mjs")], { cwd: ROOT, encoding: "utf8" });
  assert.ok(out.includes("demo-seed.sql generado"));
  const sql = readFileSync(join(ROOT, "demo-seed.sql"), "utf8");
  assert.ok(sql.includes('["/demo-media/'), "seed incluye imágenes demo");
  assert.ok((sql.match(/INSERT INTO properties/g) || []).length === 25, "25 propiedades demo");
  execFileSync("rm", [join(ROOT, "demo-seed.sql")]);
});

test("14C: UI muestra badge DEMO en cards y detalle para public_code D-*", () => {
  const index = read("public/index.html");
  assert.ok(index.includes('startsWith("D-")'), "index detecta códigos D-");
  assert.ok(index.includes("nx-card__badge--demo"), "index tiene badge DEMO");
  const property = read("public/property.html");
  assert.ok(property.includes('startsWith("D-")'), "property detecta códigos D-");
  const css = read("public/variables.css");
  assert.ok(css.includes(".nx-card__badge--demo"), "estilo badge DEMO existe");
});

test("14C: banner demo compartido está en las 7 páginas públicas", () => {
  const pages = [
    "public/index.html", "public/property.html", "public/mapa/index.html",
    "public/comparar/index.html", "public/ia/index.html", "public/cuenta/index.html",
    "public/legal.html"
  ];
  for (const p of pages) {
    assert.ok(read(p).includes("demo-banner.js"), `${p} carga demo-banner.js`);
  }
});
