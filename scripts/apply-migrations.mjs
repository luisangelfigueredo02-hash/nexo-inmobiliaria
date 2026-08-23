#!/usr/bin/env node
/* ==========================================================================
   NEXO — Aplicador de migrations D1 (local y remoto)

   Aplica migrations/*.sql en orden, con dos garantías que `wrangler d1
   migrations apply` no ofrece para este proyecto:

   1. Idempotencia del ALTER de 0007 (currency): si la columna ya existe
      (producción la recibió vía la migration histórica no versionada
      "0006_properties_currency.sql"), el ALTER se omite.
   2. Reconciliación del tracker: las entradas aplicadas se registran en
      d1_migrations sin borrar entradas históricas.

   USO:
     node scripts/apply-migrations.mjs --local
     node scripts/apply-migrations.mjs --remote
   ========================================================================== */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = "nexo-db";
const remote = process.argv.includes("--remote");
const flag = remote ? "--remote" : "--local";

function d1(sql) {
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", DB_NAME, flag, "--json", "--command", sql],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  return JSON.parse(out);
}

const files = readdirSync(join(ROOT, "migrations"))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

if (files.length === 0) {
  console.error("No se encontraron migrations.");
  process.exit(1);
}

// Estado actual: migrations ya registradas y columnas de properties.
const applied = new Set(
  d1("SELECT name FROM d1_migrations")[0].results.map((r) => r.name)
);
const columns = new Set(
  d1("PRAGMA table_info(properties)")[0].results.map((r) => r.name)
);

for (const file of files) {
  if (applied.has(file)) {
    console.log(`= ${file} (ya aplicada)`);
    continue;
  }
  let sql = readFileSync(join(ROOT, "migrations", file), "utf8");
  if (file.startsWith("0007_") && columns.has("currency")) {
    sql = sql.replace(/ALTER TABLE properties ADD COLUMN currency TEXT;/g, "SELECT 1;");
    console.log(`~ ${file}: currency ya existe, ALTER omitido`);
  }
  execFileSync(
    "npx", ["wrangler", "d1", "execute", DB_NAME, flag, "--command", sql],
    { cwd: ROOT, stdio: "inherit" }
  );
  d1(`INSERT INTO d1_migrations (name, applied_at) VALUES ('${file}', datetime('now'))`);
  console.log(`+ ${file} aplicada`);
}
console.log("Migrations reconciliadas.");
