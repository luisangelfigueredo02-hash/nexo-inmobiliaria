#!/usr/bin/env node
/* ==========================================================================
   NEXO — Demo data seeder
   Genera un archivo SQL con N propiedades de demostración realistas
   (coordenadas reales de Cuba, marcadas con 'DEMO' en internal_notes).

   USO:
     node scripts/seed-demo.mjs            → genera ./demo-seed.sql
     node scripts/seed-demo.mjs --clear    → genera ./demo-clear.sql

   APLICAR (producción):
     wrangler d1 execute nexo-db --remote --file=./demo-seed.sql
     wrangler d1 execute nexo-db --remote --file=./demo-clear.sql
   APLICAR (local):
     wrangler d1 execute nexo-db --local --file=./demo-seed.sql
   ========================================================================== */

import fs from "node:fs";

const CLEAR = process.argv.includes("--clear");
const MARK = "DEMO";

// Coordenadas reales aproximadas de municipios/barrios cubanos.
const SPOTS = [
  // La Habana
  { province: "La Habana", city: "La Habana", neighborhood: "Vedado", lat: 23.1386, lng: -82.3866 },
  { province: "La Habana", city: "La Habana", neighborhood: "Miramar", lat: 23.1156, lng: -82.4266 },
  { province: "La Habana", city: "La Habana", neighborhood: "Centro Habana", lat: 23.1330, lng: -82.3590 },
  { province: "La Habana", city: "La Habana", neighborhood: "Habana Vieja", lat: 23.1354, lng: -82.3586 },
  { province: "La Habana", city: "La Habana", neighborhood: "Playa", lat: 23.1061, lng: -82.4290 },
  { province: "La Habana", city: "La Habana", neighborhood: "Siboney", lat: 23.0967, lng: -82.4620 },
  { province: "La Habana", city: "La Habana", neighborhood: "Nuevo Vedado", lat: 23.1220, lng: -82.4000 },
  { province: "La Habana", city: "La Habana", neighborhood: "Cerro", lat: 23.1080, lng: -82.3730 },
  // Matanzas
  { province: "Matanzas", city: "Varadero", neighborhood: "Centro", lat: 23.1568, lng: -81.2444 },
  { province: "Matanzas", city: "Varadero", neighborhood: "Kawama", lat: 23.1640, lng: -81.2270 },
  { province: "Matanzas", city: "Matanzas", neighborhood: "Centro", lat: 23.0411, lng: -81.5775 },
  // Cienfuegos
  { province: "Cienfuegos", city: "Cienfuegos", neighborhood: "Punta Gorda", lat: 22.1300, lng: -80.4450 },
  { province: "Cienfuegos", city: "Cienfuegos", neighborhood: "Centro", lat: 22.1469, lng: -80.4363 },
  // Trinidad
  { province: "Sancti Spíritus", city: "Trinidad", neighborhood: "Centro Histórico", lat: 21.8038, lng: -79.9842 },
  // Santiago
  { province: "Santiago de Cuba", city: "Santiago de Cuba", neighborhood: "Vista Alegre", lat: 20.0210, lng: -75.8150 },
  { province: "Santiago de Cuba", city: "Santiago de Cuba", neighborhood: "Centro", lat: 20.0247, lng: -75.8219 },
  // Holguín
  { province: "Holguín", city: "Holguín", neighborhood: "Centro", lat: 20.8872, lng: -76.2631 },
  // Camagüey
  { province: "Camagüey", city: "Camagüey", neighborhood: "Centro", lat: 21.3808, lng: -77.9169 },
  // Villa Clara
  { province: "Villa Clara", city: "Santa Clara", neighborhood: "Centro", lat: 22.4069, lng: -79.9644 },
  // Pinar
  { province: "Pinar del Río", city: "Viñales", neighborhood: "Centro", lat: 22.6189, lng: -83.7058 },
  // Guantánamo
  { province: "Guantánamo", city: "Baracoa", neighborhood: "Centro", lat: 20.3467, lng: -74.4969 },
  // Ciego
  { province: "Ciego de Ávila", city: "Morón", neighborhood: "Centro", lat: 22.1111, lng: -78.6275 },
  // Mayabeque
  { province: "Mayabeque", city: "San José", neighborhood: "Centro", lat: 22.7958, lng: -82.1511 },
  // Artemisa
  { province: "Artemisa", city: "Artemisa", neighborhood: "Centro", lat: 22.8136, lng: -82.7619 },
  // Granma
  { province: "Granma", city: "Bayamo", neighborhood: "Centro", lat: 20.3794, lng: -76.6433 }
];

const TYPES = ["casa", "apartamento", "terreno", "penthouse"];
const OPS = ["venta", "alquiler"];
const TYPE_LABEL = { casa: "Casa", apartamento: "Apartamento", terreno: "Terreno", penthouse: "Penthouse" };

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function jitter(v) { return v + (Math.random() - 0.5) * 0.008; } // ~±0.4 km
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const properties = SPOTS.map((spot, i) => {
  const type = TYPES[i % TYPES.length];
  const operation = OPS[i % OPS.length];
  const base = type === "terreno" ? 8000 : type === "penthouse" ? 60000 : type === "apartamento" ? 25000 : 35000;
  const price = operation === "alquiler"
    ? rand(250, 900)
    : base + rand(-5000, 45000);
  const bedrooms = type === "terreno" ? 0 : rand(1, 5);
  const bathrooms = type === "terreno" ? 0 : rand(1, 3);
  const area = type === "terreno" ? rand(200, 1200) : rand(45, 240);
  const lat = jitter(spot.lat);
  const lng = jitter(spot.lng);
  const desc = `${TYPE_LABEL[type]} en ${spot.neighborhood}, ${spot.city}. ` +
    (type === "terreno"
      ? "Ubicación privilegiada, ideal para desarrollo."
      : `${bedrooms} habitaciones, ${bathrooms} baño(s), ${area} m². Buen estado y ubicación.`);

  return {
    public_code: `D-${String(i + 1).padStart(3, "0")}`,
    title: `${TYPE_LABEL[type]} en ${spot.neighborhood}`,
    type, operation, price,
    province: spot.province, city: spot.city, neighborhood: spot.neighborhood,
    address: null,
    bedrooms, bathrooms, area,
    description: desc,
    // Imágenes de demostración PROPIAS (SVG generados en /demo-media, con
    // marca de agua DEMO). Nunca fotos de terceros: cero riesgo de licencia.
    images: JSON.stringify([`/demo-media/${type}.svg`]),
    latitude: lat.toFixed(6),
    longitude: lng.toFixed(6),
    status: "published",
    owner_name: "Contacto DEMO",
    owner_phone: "+5355550000",
    internal_notes: MARK,
    contact_email: null
  };
});

function esc(v) { return v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`; }
function num(v) { return v === null || v === undefined ? "NULL" : String(v); }

if (CLEAR) {
  const sql = [
    "-- NEXO demo clear: elimina TODAS las propiedades de demostración (incluye N-001 si era demo).",
    "-- Marcador: internal_notes = 'DEMO' OR public_code LIKE 'D-%'.",
    `DELETE FROM properties WHERE internal_notes = '${MARK}' OR public_code LIKE 'D-%';`,
    "-- Reinicia la secuencia de public_code para que no salte tras clear.",
    "UPDATE listing_id_sequence SET value = 0 WHERE name = 'public_code';"
  ].join("\n");
  fs.writeFileSync("demo-clear.sql", sql + "\n");
  console.log("✓ demo-clear.sql generado (elimina todas las propiedades DEMO).");
  process.exit(0);
}

const inserts = properties.map(p => `INSERT INTO properties (
  public_code, title, type, operation, price, province, city, neighborhood, address,
  bedrooms, bathrooms, area, description, images, latitude, longitude, status,
  owner_name, owner_phone, internal_notes, contact_email
) VALUES (
  ${esc(p.public_code)}, ${esc(p.title)}, ${esc(p.type)}, ${esc(p.operation)}, ${num(p.price)},
  ${esc(p.province)}, ${esc(p.city)}, ${esc(p.neighborhood)}, ${esc(p.address)},
  ${num(p.bedrooms)}, ${num(p.bathrooms)}, ${num(p.area)}, ${esc(p.description)}, ${esc(p.images)},
  ${num(p.latitude)}, ${num(p.longitude)}, ${esc(p.status)},
  ${esc(p.owner_name)}, ${esc(p.owner_phone)}, ${esc(p.internal_notes)}, ${esc(p.contact_email)}
);`);

const sql = [
  "-- NEXO demo seed: " + properties.length + " propiedades de demostración con coords reales.",
  "-- Marcadas con internal_notes='DEMO'. Limpiar con scripts/seed-demo.mjs --clear.",
  "-- Activa DEMO_MODE=1 en wrangler.toml para mostrar el banner en la UI.",
  ...inserts
].join("\n");

fs.writeFileSync("demo-seed.sql", sql + "\n");
console.log(`✓ demo-seed.sql generado con ${properties.length} propiedades DEMO (coords reales).`);
console.log("  Aplicar:  wrangler d1 execute nexo-db --remote --file=./demo-seed.sql");
console.log("  Limpiar:  node scripts/seed-demo.mjs --clear && wrangler d1 execute nexo-db --remote --file=./demo-clear.sql");
