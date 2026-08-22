/* =========================================================
   NEXO — FIELD-LEVEL AUTHORIZATION (04.5)
   Serialización WHITELIST por audiencia (04.4 §11): jamás
   blacklist ni `delete` tras SELECT *. Solo entran en la
   respuesta los campos listados y presentes en la fila; la
   audiencia se deriva del actor server-side, nunca del cliente.
========================================================= */

import { ACTOR_TYPES, ROLES, RELATIONSHIPS } from "./roles.js";
import { LEGACY_ADMIN_PLANE } from "./matrix.js";

// Campos públicos: base de todas las audiencias de property.
const PROPERTY_PUBLIC_FIELDS = Object.freeze([
  "id", "public_code", "title", "type", "operation", "price",
  "province", "city", "neighborhood", "bedrooms", "bathrooms",
  "area", "description", "images", "latitude", "longitude",
  "created_at",
]);

// OWNER/AGENT del listing: + datos de contacto y estado propio.
const PROPERTY_OWNER_FIELDS = Object.freeze([
  ...PROPERTY_PUBLIC_FIELDS,
  "address", "owner_name", "owner_phone", "status",
]);

// MODERATOR: + campos internos para decidir. Nunca credenciales.
const PROPERTY_MODERATOR_FIELDS = Object.freeze([
  ...PROPERTY_OWNER_FIELDS,
  "internal_notes", "created_by",
]);

// ADMIN: mismos campos de decisión que moderación (el panel
// legado ya los consume). Campos de seguridad (stamps, hashes,
// tokens, secretos) NO existen en properties y jamás se añaden.
const PROPERTY_ADMIN_FIELDS = Object.freeze([...PROPERTY_MODERATOR_FIELDS]);

const AUDIENCE_FIELDS = Object.freeze({
  public: PROPERTY_PUBLIC_FIELDS,
  owner: PROPERTY_OWNER_FIELDS,
  moderator: PROPERTY_MODERATOR_FIELDS,
  admin: PROPERTY_ADMIN_FIELDS,
});

export const AUDIENCES = Object.freeze(Object.keys(AUDIENCE_FIELDS));

// Audiencia de un actor para un listing concreto.
export function propertyAudienceFor(actor, relationship = null) {
  if (!actor || typeof actor !== "object") return "public";
  if (actor.type === ACTOR_TYPES.SYSTEM) {
    return actor.plane === LEGACY_ADMIN_PLANE ? "admin" : "public";
  }
  if (actor.type !== ACTOR_TYPES.USER) return "public";
  if ((actor.roles || []).includes(ROLES.ADMIN)) return "admin";
  if ((actor.roles || []).includes(ROLES.MODERATOR)) return "moderator";
  if (relationship === RELATIONSHIPS.OWNER || relationship === RELATIONSHIPS.AGENT) return "owner";
  return "public";
}

function parseImages(value) {
  if (Array.isArray(value)) return value.filter(v => typeof v === "string");
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(v => typeof v === "string");
    if (typeof parsed === "string") return [parsed];
    return [];
  } catch (e) {
    if (typeof value === "string" && (value.startsWith("/") || value.startsWith("https://"))) return [value];
    return [];
  }
}

// Serializa una fila de properties según la whitelist de la
// audiencia. `images` se normaliza a array. Campos ausentes en
// la fila no se inventan; campos fuera de la whitelist (aunque
// existan en la fila: address, owner_*, internal_notes, stamps,
// password_hash, ...) jamás cruzan a una audiencia inferior.
export function serializeProperty(row, audience) {
  const fields = AUDIENCE_FIELDS[audience];
  if (!row || typeof row !== "object" || !fields) return null;
  const out = {};
  for (const key of fields) {
    if (row[key] === undefined) continue;
    out[key] = key === "images" ? parseImages(row[key]) : row[key];
  }
  return out;
}
