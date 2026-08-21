#!/usr/bin/env node
/*
 * Genera y verifica los hashes sha256 de los <script> inline ejecutables
 * presentes en los HTML de public/ (recursivo). Es la única fuente de verdad para el
 * bloque CSP script-src hash-based embebido en worker.js.
 *
 * Uso:
 *   node scripts/generate-csp-hashes.mjs           → verifica drift (exit 1 si worker.js desincronizado)
 *   node scripts/generate-csp-hashes.mjs --write   → reescribe el bloque generado en worker.js
 *
 * Guard: falla si detecta handlers inline (on*=) en el markup — esos
 * handlers se bloquearían bajo CSP sin 'unsafe-inline' y señalan un
 * refactor pendiente a delegación con addEventListener.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PUBLIC_DIR = join(ROOT, "public");
const WORKER = join(ROOT, "worker.js");

const MARK_BEGIN = "// === GENERATED CSP-SCRIPT-SRC:BEGIN (scripts/generate-csp-hashes.mjs, no editar a mano) ===";
const MARK_END = "// === GENERATED CSP-SCRIPT-SRC:END ===";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".html")) yield p;
  }
}

const errors = [];
const hashes = new Set();

for (const file of walk(PUBLIC_DIR)) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(PUBLIC_DIR.length + 1);

  // Guard: handlers inline
  for (const m of src.matchAll(/\son[a-z]+\s*=/gi)) {
    const line = src.slice(0, m.index).split("\n").length;
    errors.push(`${rel}:${line} handler inline detectado: ${m[0].trim()}`);
  }

  // Scripts inline ejecutables (sin src; type JS o ausente)
  for (const m of src.matchAll(/<script(?![^>]*\bsrc\b)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const type = attrs.match(/type\s*=\s*["']([^"']+)["']/i)?.[1].trim().toLowerCase() ?? "";
    const executable = ["", "module", "text/javascript", "application/javascript", "javascript", "importmap"].includes(type);
    if (!executable) continue; // application/ld+json, text/template…: no rige script-src
    const digest = createHash("sha256").update(m[2], "utf8").digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }
}

if (errors.length) {
  console.error("CSP hash generator: handlers inline encontrados (rompen CSP sin unsafe-inline):\n" + errors.join("\n"));
  process.exit(1);
}

const directive = ["'self'", "https://unpkg.com", ...[...hashes].sort()].join(" ");
const generatedLine = `const CSP_SCRIPT_SRC = ${JSON.stringify(directive)};`;

const workerSrc = readFileSync(WORKER, "utf8");
const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRe = new RegExp(escaped(MARK_BEGIN) + "[\\s\\S]*?" + escaped(MARK_END));
const match = workerSrc.match(blockRe);

if (!match) {
  console.error("worker.js no contiene los marcadores del bloque generado. Inserta:\n" + MARK_BEGIN + "\n" + MARK_END);
  process.exit(1);
}

const current = match[0];
const expected = `${MARK_BEGIN}\n${generatedLine}\n${MARK_END}`;

if (process.argv.includes("--write")) {
  writeFileSync(WORKER, workerSrc.replace(blockRe, expected));
  console.log(`worker.js actualizado: ${hashes.size} hash(es) en CSP_SCRIPT_SRC.`);
  process.exit(0);
}

if (current !== expected) {
  console.error("DRIFT: CSP_SCRIPT_SRC en worker.js no coincide con los scripts inline de public/.\nEjecuta: node scripts/generate-csp-hashes.mjs --write");
  process.exit(1);
}

console.log(`OK: ${hashes.size} hash(es) CSP sincronizados con worker.js.`);
