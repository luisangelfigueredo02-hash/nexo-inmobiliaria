/* =========================================================
   NEXO — AUTHORIZATION RUNTIME (04.5) — API pública del módulo
   Mecanismo central reutilizable (04.4 §22 / 04.5 §35):
   los endpoints protegidos componen resolveActor/legacyAdminActor
   + authorize() + denyResponse() + emitAuthorizationAudit().
   Ningún endpoint reimplementa la lógica de decisión.
========================================================= */

export { PERMISSIONS, isKnownPermission } from "./permissions.js";
export { ACTOR_TYPES, ROLES, RELATIONSHIPS, anonymousActor } from "./roles.js";
export { PUBLIC_GRANTS, USER_GRANTS, ROLE_GRANTS, LEGACY_ADMIN_PLANE, LEGACY_ADMIN_PLANE_ACTIONS } from "./matrix.js";
export { resolveActor, legacyAdminActor } from "./actor.js";
export { authorize, DECISION } from "./authorize.js";
export { classifyListingIdentifier, resolveListing } from "./resource.js";
export { getListingRelationship } from "./ownership.js";
export { AUDIENCES, propertyAudienceFor, serializeProperty } from "./serialize.js";
export { emitAuthorizationAudit } from "./audit.js";

import { DECISION } from "./authorize.js";

// Mapeo de decisión → respuesta HTTP segura (04.4 §6.3/§15):
// - Sin autenticación → 401.
// - Autenticado sin autorización sobre un listing → 404
//   indistinguible (anti existence-oracle) para no-staff;
//   staff (decisión con resource resuelto vía rol) recibe 403
//   semántico. El cuerpo nunca revela ownership, roles ni
//   políticas internas.
export function denyResponse(decision, { corsHeaders = {}, staff = false, resourceScoped = true } = {}) {
  const unauthenticated = decision && decision.reason === "authentication_required";
  const status = unauthenticated ? 401 : (staff || !resourceScoped ? 403 : 404);
  const error = unauthenticated ? "No autenticado" : (status === 404 ? "Recurso no encontrado" : "No autorizado");
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function isAllowed(decision) {
  return !!decision && decision.decision === DECISION.ALLOW;
}
