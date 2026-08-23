import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "migrations");

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(ROOT, "schema.sql"), "utf8"));
  return db;
}

// Aplica una migration omitiendo ADD COLUMN de columnas que el schema
// canónico ya incluye (mismo criterio que scripts/apply-migrations.mjs:
// la columna es el contrato, no el ALTER).
function applyMigration(db, file) {
  const cols = new Set(db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name));
  let sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  sql = sql.replace(
    /ALTER TABLE properties ADD COLUMN (\w+)[^;]*;/g,
    (m, col) => (cols.has(col) ? "SELECT 1;" : m)
  );
  db.exec(sql);
}

test("migration ids son únicos y secuenciales", () => {
  const ids = migrationFiles.map((f) => f.slice(0, 4));
  assert.equal(new Set(ids).size, ids.length, `IDs duplicados: ${ids}`);
  ids.forEach((id, i) => {
    assert.equal(parseInt(id, 10), i + 1, `Gap de numeración en ${migrationFiles[i]}`);
  });
});

test("bootstrap desde cero: schema.sql + todas las migrations aplican sin error", () => {
  const db = freshDb();
  for (const file of migrationFiles) {
    applyMigration(db, file);
  }
  db.close();
});

test("0007 es idempotente cuando currency ya existe (caso producción)", () => {
  const db = freshDb();
  // Simula producción: currency ya presente (llegó por vía no versionada).
  const sql0007 = readFileSync(join(MIGRATIONS_DIR, "0007_schema_reconciliation.sql"), "utf8");
  const cols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  assert.ok(cols.includes("currency"), "schema.sql debe incluir currency");
  // Aplicar el ALTER de nuevo debe fallar → el aplicador debe omitirlo.
  assert.throws(() => db.exec("ALTER TABLE properties ADD COLUMN currency TEXT"));
  // Pero el archivo 0007 con el ALTER omitido aplica limpio.
  const sanitized = sql0007.replace(/ALTER TABLE properties ADD COLUMN currency TEXT;/g, "SELECT 1;");
  db.exec(sanitized);
  db.close();
});

test("columnas que worker.js selecciona existen tras bootstrap completo", () => {
  const db = freshDb();
  for (const file of migrationFiles) {
    applyMigration(db, file);
  }
  const cols = new Set(db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name));
  const required = [
    "id", "public_code", "title", "type", "operation", "price", "currency",
    "province", "city", "neighborhood", "address", "bedrooms", "bathrooms",
    "area", "description", "images", "latitude", "longitude", "status",
    "owner_name", "owner_phone", "internal_notes", "created_at",
    "placa_libre", "gas_calle", "agua_247", "pago_exterior"
  ];
  for (const col of required) {
    assert.ok(cols.has(col), `Falta columna properties.${col} tras bootstrap`);
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name));
  for (const t of ["accounts", "profiles", "sessions", "account_favorites", "listing_id_sequence", "audit_events"]) {
    assert.ok(tables.has(t), `Falta tabla ${t} tras bootstrap`);
  }
  db.close();
});

test("INSERT con currency funciona tras bootstrap (regresión P0 Gate 13)", () => {
  const db = freshDb();
  for (const file of migrationFiles) {
    applyMigration(db, file);
  }
  db.prepare(
    `INSERT INTO properties (public_code, title, type, operation, price, currency, province, city, neighborhood)
     VALUES ('N-900', 'Test', 'casa', 'venta', 1000, 'USD', 'P', 'C', 'N')`
  ).run();
  const row = db.prepare("SELECT currency FROM properties WHERE public_code = 'N-900'").get();
  assert.equal(row.currency, "USD");
  db.close();
});

test("apply-migrations.mjs usa el mismo sanitizador genérico que este test (anti-drift Gate 16)", () => {
  const script = readFileSync(join(ROOT, "scripts", "apply-migrations.mjs"), "utf8");
  assert.match(script, /ALTER TABLE properties ADD COLUMN \(\\w\+\)/,
    "El aplicador debe omitir genéricamente ADD COLUMN de columnas existentes (no solo 0007)");
  assert.match(script, /CREATE TABLE IF NOT EXISTS d1_migrations/,
    "El aplicador debe crear el tracker si no existe (D1 recién creada)");
  assert.match(script, /SELECT 1;\\n" \+ sql|"SELECT 1;\\n" \+ sql/,
    "El aplicador debe prefijar el statement no-op (yargs rechaza --command que empieza por --)");
});
