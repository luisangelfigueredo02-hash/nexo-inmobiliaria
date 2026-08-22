/* =========================================================
   NEXO — RESOURCE RESOLUTION (04.5)
   public_code ('N-001') ↔ internal id (properties.id INTEGER).
   La decisión de columna es por PATRÓN, nunca por CAST del
   valor (04.4.1 / LISTING-IDENTITY.md). La autorización opera
   siempre contra el id interno; public_code solo identifica.
========================================================= */

const PUBLIC_CODE_RE = /^N-\d+$/i;

export function classifyListingIdentifier(ref) {
  const value = String(ref ?? "");
  return PUBLIC_CODE_RE.test(value)
    ? { column: "public_code", value: value.toUpperCase() }
    : { column: "id", value };
}

// Devuelve la fila mínima de decisión o null. Los errores de D1
// propagan: authorize() los convierte en DENY (fail-closed).
export async function resolveListing(env, ref) {
  const { column, value } = classifyListingIdentifier(ref);
  const row = await env.DB.prepare(
    `SELECT id, public_code, status, created_by FROM properties WHERE ${column} = ?`
  ).bind(value).first();
  return row || null;
}
