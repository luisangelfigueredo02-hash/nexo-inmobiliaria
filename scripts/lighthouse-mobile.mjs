#!/usr/bin/env node
/* ==========================================================================
   NEXO — Auditoría Lighthouse móvil reproducible (14I / Gate 13X)

   Metodología fija (no negociable entre mediciones):
     - Chrome headless, emulación Moto G Power (Slow 4G, CPU 4x)
     - 3 corridas por URL; se reporta la MEDIANA de cada categoría
     - Sin extensión, sin auth, cache fría entre corridas

   Uso:
     node scripts/lighthouse-mobile.mjs [baseUrl]

   Requiere Chrome/Chromium en PATH (CHROME_PATH para override).
   Instala lighthouse bajo demanda en .lighthouse-tmp (fuera del repo git).
   ========================================================================== */

import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "reports", "lighthouse");
const TMP_DIR = join(ROOT, ".lighthouse-tmp");
const BASE = process.argv[2] || "https://nexo-inmueble.luisangelfigueredo02.workers.dev";

const URLS = ["/", "/mapa/", "/comparar/", "/ia/", "/cuenta/", "/property.html?id=N-001"];
const RUNS = 3;

const PRESETS = {
  formFactor: "mobile",
  screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2.625, disabled: false },
  throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 }
};

function ensureLighthouse() {
  if (existsSync(join(TMP_DIR, "node_modules", "lighthouse", "package.json"))) return;
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({ name: "lh-tmp", private: true }));
  console.error("[lighthouse] instalando (una sola vez)…");
  const r = spawnSync("npm", ["install", "--prefix", TMP_DIR, "lighthouse@^12", "--no-audit", "--no-fund"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("npm install lighthouse falló");
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [bin], { encoding: "utf8" }).trim();
    } catch { /* siguiente */ }
  }
  return null;
}

async function runOnce(lighthouse, chrome, url) {
  const flags = {
    chromePath: chrome,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    port: 9222,
    ...PRESETS
  };
  const result = await lighthouse(url, flags);
  const lhr = result.lhr;
  return {
    categories: Object.fromEntries(
      Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)])
    ),
    metrics: {
      FCP: lhr.audits["first-contentful-paint"]?.numericValue,
      LCP: lhr.audits["largest-contentful-paint"]?.numericValue,
      CLS: lhr.audits["cumulative-layout-shift"]?.numericValue,
      TBT: lhr.audits["total-blocking-time"]?.numericValue
    }
  };
}

const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];

async function main() {
  ensureLighthouse();
  const chrome = chromePath();
  if (!chrome) {
    console.error("ERROR: no se encontró Chrome/Chromium. Define CHROME_PATH.");
    process.exit(2);
  }
  // Arranca Chrome con depuración remota: lighthouse se conecta a él.
  const chromeProc = (await import("node:child_process")).spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=9222", "--user-data-dir=/tmp/lh-chrome-profile", "about:blank"
  ], { stdio: "ignore" });
  await new Promise((res) => setTimeout(res, 2500));
  const { default: lighthouse } = await import(join(TMP_DIR, "node_modules", "lighthouse", "core", "index.js"));

  mkdirSync(OUT_DIR, { recursive: true });
  const report = { base: BASE, date: new Date().toISOString(), preset: PRESETS, runs: RUNS, pages: {} };

  for (const path of URLS) {
    const url = BASE.replace(/\/$/, "") + path;
    console.error(`[lighthouse] ${path} ×${RUNS}…`);
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      runs.push(await runOnce(lighthouse, chrome, url));
    }
    report.pages[path] = {
      performance: median(runs.map((r) => r.categories.performance)),
      accessibility: median(runs.map((r) => r.categories.accessibility)),
      "best-practices": median(runs.map((r) => r.categories["best-practices"])),
      seo: median(runs.map((r) => r.categories.seo)),
      LCP_ms: median(runs.map((r) => r.metrics.LCP || 0)),
      CLS: median(runs.map((r) => Math.round((r.metrics.CLS || 0) * 1000) / 1000)),
      TBT_ms: median(runs.map((r) => r.metrics.TBT || 0))
    };
    console.error(`  perf=${report.pages[path].performance} a11y=${report.pages[path].accessibility} seo=${report.pages[path].seo}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(OUT_DIR, `lighthouse-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  writeFileSync(join(OUT_DIR, "latest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.pages, null, 2));
  console.error(`[lighthouse] reporte → ${outFile}`);
  chromeProc.kill("SIGKILL");
}

main().catch((err) => { console.error(err); process.exit(1); });
