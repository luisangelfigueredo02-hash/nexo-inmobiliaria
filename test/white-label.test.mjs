import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrand, applyTokens, buildManifest } from "../src/brand.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (name.endsWith(".html")) yield p;
  }
}

const PAGES = [];
for (const f of walk(PUBLIC_DIR)) PAGES.push(f);

const CASANOVA_ENV = {
  BRAND_NAME: "CASANOVA",
  BRAND_TAGLINE: "Tu hogar te espera.",
  BRAND_DESCRIPTION: "Portal inmobiliario CASANOVA de ejemplo.",
  WHATSAPP_PHONE: "+1555000111",
  MARKET_COUNTRY: "México",
  MARKET_COUNTRY_CODE: "MX",
  MARKET_LOCALE: "es_MX",
  LEGAL_NAME: "CASANOVA S.A. de C.V.",
  CONTACT_EMAIL: "hola@casanova.example"
};

test("buildBrand aplica overrides de entorno", () => {
  const b = buildBrand(CASANOVA_ENV);
  assert.equal(b.name, "CASANOVA");
  assert.equal(b.whatsapp, "+1555000111");
  assert.equal(b.country, "México");
  assert.equal(b.countryCode, "MX");
  assert.equal(b.legalName, "CASANOVA S.A. de C.V.");
});

test("buildBrand defaults NEXO sin env", () => {
  const b = buildBrand({});
  assert.equal(b.name, "NEXO");
  assert.equal(b.country, "Cuba");
  assert.equal(b.countryCode, "CU");
  // Sin WHATSAPP_PHONE configurado el default es vacío: el código nunca
  // embebe un número personal; los CTAs de WhatsApp se ocultan (Gate 20).
  assert.equal(b.whatsapp, "");
});

test("applyTokens sustituye todos los tokens y escapa HTML", () => {
  const b = buildBrand({ BRAND_NAME: 'X<script>' });
  const out = applyTokens("<title>{{BRAND_NAME}}</title>{{MARKET_COUNTRY}}{{WHATSAPP_PHONE}}{{YEAR}}", b, "https://x.dev");
  assert.ok(!out.includes("{{"), `Tokens sin resolver: ${out}`);
  assert.ok(!out.includes("<script>"), "debe escapar HTML en valores de marca");
});

test("manifest dinámico refleja la marca", () => {
  const b = buildBrand(CASANOVA_ENV);
  const m = buildManifest(b, "https://casanova.example");
  assert.equal(m.short_name, "CASANOVA");
  assert.ok(m.name.includes("CASANOVA"));
  assert.equal(m.lang, "es-MX");
});

test("CASANOVA e2e: ninguna página pública sirve el literal NEXO tras applyTokens", () => {
  const b = buildBrand(CASANOVA_ENV);
  for (const page of PAGES) {
    const raw = readFileSync(page, "utf8");
    const out = applyTokens(raw, b, "https://casanova.example");
    const rel = page.slice(PUBLIC_DIR.length + 1);
    assert.ok(!out.includes("{{"), `${rel}: tokens sin resolver`);
    // El literal NEXO solo puede quedar en identificadores técnicos
    // (localStorage keys, cache names, comentarios de código).
    const visible = out
      .replace(/nexo_favs|nexo-v\d[^"']*|nexo-static|nexo-data|nexo-images/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.ok(!/NEXO/.test(visible), `${rel}: literal NEXO visible tras rebrand:\n${visible.match(/.{0,40}NEXO.{0,40}/)?.[0]}`);
  }
});

test("NEXO default: las páginas resuelven a la marca NEXO", () => {
  const b = buildBrand({});
  const raw = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
  const out = applyTokens(raw, b, "https://nexo.dev");
  assert.ok(out.includes("NEXO"), "index debe mostrar NEXO por defecto");
  assert.ok(!out.includes("{{"), "sin tokens sin resolver");
});

test("toda página pública carga el banner demo compartido", () => {
  for (const page of PAGES) {
    const rel = page.slice(PUBLIC_DIR.length + 1);
    if (rel === "admin.html") continue; // admin no es público
    const raw = readFileSync(page, "utf8");
    assert.ok(raw.includes("/demo-banner.js"), `${rel} debe cargar /demo-banner.js`);
  }
});

test("footer de index enlaza a páginas legales reales", () => {
  const raw = readFileSync(join(PUBLIC_DIR, "index.html"), "utf8");
  assert.ok(raw.includes('href="/legal.html#privacidad"'), "link privacidad");
  assert.ok(raw.includes('href="/legal.html#terminos"'), "link términos");
  assert.ok(raw.includes('href="/legal.html#contacto"'), "link contacto");
});

test("legal.html existe y no contiene placeholders internos", () => {
  const raw = readFileSync(join(PUBLIC_DIR, "legal.html"), "utf8");
  assert.ok(!/LEGAL CONTENT REQUIRES HUMAN CONFIRMATION/i.test(raw));
  assert.ok(!/TODO|FIXME|PLACEHOLDER/i.test(raw));
});
