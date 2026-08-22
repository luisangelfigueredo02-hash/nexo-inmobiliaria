/* =========================================================
   NEXO — OWNERSHIP LOOKUP (04.5)
   Fuente de verdad: listing_owners (relación vigente si
   revoked_at IS NULL) contra properties.id INTEGER (04.4 §5).
   Jamás se acepta owner_id/account_id del cliente: la relación
   se consulta server-side en cada decisión.
========================================================= */

// Devuelve 'owner' | 'agent' | 'managed_by' | null. Los errores
// de D1 propagan: authorize() los convierte en DENY (fail-closed).
export async function getListingRelationship(env, listingId, accountId) {
  if (accountId == null || listingId == null) return null;
  const row = await env.DB.prepare(
    `SELECT relationship FROM listing_owners
     WHERE listing_id = ? AND account_id = ? AND revoked_at IS NULL`
  ).bind(listingId, accountId).first();
  return row ? row.relationship : null;
}
