/* =========================================================
   NEXO — AUTHORIZATION DECISION CORE (04.5)
   authorize(actor, action, resource, { env }) →
     { decision: 'ALLOW' | 'DENY', reason, resource?, relationship? }

   Contrato (04.4 §1/§16):
   - Decisión explícita y auditable; jamás undefined/truthy.
   - Deny-by-default: sin regla/condición satisfecha → DENY.
   - Fail-closed: cualquier error de lookup (D1, roles,
     ownership, recurso) → DENY. Ningún catch produce ALLOW.
   - El cliente NUNCA aporta rol, accountId, owner_id ni
     relationship: actor viene de Session Runtime y la relación
     se consulta en listing_owners server-side en cada decisión.
========================================================= */

import { PERMISSIONS, isKnownPermission } from "./permissions.js";
import { ACTOR_TYPES, RELATIONSHIPS } from "./roles.js";
import { PUBLIC_GRANTS, USER_GRANTS, ROLE_GRANTS, LEGACY_ADMIN_PLANE, LEGACY_ADMIN_PLANE_ACTIONS } from "./matrix.js";
import { resolveListing } from "./resource.js";
import { getListingRelationship } from "./ownership.js";

export const DECISION = Object.freeze({ ALLOW: "ALLOW", DENY: "DENY" });

function deny(reason, extra = {}) {
  return { decision: DECISION.DENY, reason, ...extra };
}
function allow(reason, extra = {}) {
  return { decision: DECISION.ALLOW, reason, ...extra };
}

// Acciones que operan sobre un listing concreto: exigen
// resolución de recurso (existencia, estado) antes de evaluar.
const LISTING_SCOPED_ACTIONS = new Set([
  PERMISSIONS.PROPERTY_READ_PUBLIC,
  PERMISSIONS.PROPERTY_READ_PRIVATE,
  PERMISSIONS.PROPERTY_READ_INTERNAL,
  PERMISSIONS.PROPERTY_UPDATE,
  PERMISSIONS.PROPERTY_DELETE,
  PERMISSIONS.PROPERTY_SUBMIT,
  PERMISSIONS.PROPERTY_ARCHIVE,
  PERMISSIONS.MODERATION_REVIEW,
  PERMISSIONS.MODERATION_APPROVE,
  PERMISSIONS.MODERATION_REJECT,
  PERMISSIONS.MODERATION_REQUEST_CHANGES,
  PERMISSIONS.MODERATION_SUSPEND_LISTING,
  PERMISSIONS.LISTING_UNPUBLISH,
]);

// Estados actuales del schema (published/draft); los estados del
// workflow completo (04.4 §6.1) se listan para que las condiciones
// ya sean correctas cuando 04.7/04.8 los introduzca.
const DELETABLE_STATES = new Set(["draft", "rejected"]);
const SUBMITTABLE_STATES = new Set(["draft", "changes_requested"]);

const OWNER_OR_AGENT = new Set([RELATIONSHIPS.OWNER, RELATIONSHIPS.AGENT]);

// Condiciones USER sobre listing (04.4 §12). Reciben
// (resource, relationship) resueltos server-side.
const USER_LISTING_CONDITIONS = {
  [PERMISSIONS.PROPERTY_READ_PRIVATE]: (res, rel) => OWNER_OR_AGENT.has(rel),
  [PERMISSIONS.PROPERTY_UPDATE]: (res, rel) => OWNER_OR_AGENT.has(rel),
  [PERMISSIONS.PROPERTY_DELETE]: (res, rel) => rel === RELATIONSHIPS.OWNER && DELETABLE_STATES.has(res.status),
  [PERMISSIONS.PROPERTY_SUBMIT]: (res, rel) => OWNER_OR_AGENT.has(rel) && SUBMITTABLE_STATES.has(res.status),
  [PERMISSIONS.PROPERTY_ARCHIVE]: (res, rel) => rel === RELATIONSHIPS.OWNER,
};

function evaluateUserAction(actor, action, resource, relationship) {
  if (!USER_GRANTS.includes(action)) return null;

  if (action === PERMISSIONS.PROPERTY_CREATE) {
    // Toda cuenta autenticada crea en estado draft; el endpoint
    // (04.7) fuerza draft, el cliente jamás fija published.
    return allow("user_grant:property.create");
  }

  const condition = USER_LISTING_CONDITIONS[action];
  if (!condition) return deny("no_condition_defined", { resource, relationship });
  if (!resource) return deny("resource_not_found", { relationship });
  return condition(resource, relationship)
    ? allow(`user_grant:${action}`, { resource, relationship })
    : deny("condition_not_met", { resource, relationship });
}

function evaluateRoleGrants(actor, action, resource) {
  for (const role of actor.roles || []) {
    const grants = ROLE_GRANTS[role];
    if (!grants || !grants.includes(action)) continue; // rol desconocido: no otorga nada
    if (LISTING_SCOPED_ACTIONS.has(action) && !resource) {
      return deny("resource_not_found");
    }
    return allow(`role_grant:${role}:${action}`, { resource });
  }
  return null;
}

function evaluatePublic(action, resource) {
  if (!PUBLIC_GRANTS.includes(action)) return null;
  if (action === PERMISSIONS.CONFIG_READ) return allow("public_grant:config.read");
  // property.read_public: solo listings published (04.4 §6.3).
  if (!resource) return deny("resource_not_found");
  return resource.status === "published"
    ? allow("public_grant:property.read_public", { resource })
    : deny("resource_not_public", { resource });
}

// resource: { type: 'property', ref } | { type: '<otro>' } | null.
// Cualquier campo extra en `resource` (p.ej. relationship u
// owner_id forjados por un cliente) se IGNORA: la relación se
// resuelve exclusivamente contra listing_owners.
export async function authorize(actor, action, resource = null, { env } = {}) {
  // 1. Actor válido.
  if (!actor || typeof actor !== "object" || !Object.values(ACTOR_TYPES).includes(actor.type)) {
    return deny("invalid_actor");
  }
  // 2. Acción conocida (catálogo cerrado).
  if (!isKnownPermission(action)) {
    return deny("unknown_action");
  }
  // 3. Fail-closed: error previo resolviendo roles (04.5 actor.js).
  if (actor.rolesError) {
    return deny("role_resolution_failed");
  }

  // 4. Plano system: lista cerrada y enumerada por plano. Un
  //    actor system NUNCA proviene de una petición HTTP directa
  //    (lo construye un gate server-side, p.ej. el Bearer legado).
  if (actor.type === ACTOR_TYPES.SYSTEM) {
    if (actor.plane === LEGACY_ADMIN_PLANE && LEGACY_ADMIN_PLANE_ACTIONS.includes(action)) {
      return allow(`system_plane:${LEGACY_ADMIN_PLANE}:${action}`);
    }
    return deny("system_action_not_enumerated");
  }

  // 5. Resolución de recurso + ownership (solo acciones con scope
  //    de listing). Cualquier fallo de lookup → DENY (fail-closed).
  let resolved = null;
  let relationship = null;
  if (LISTING_SCOPED_ACTIONS.has(action)) {
    if (!resource || resource.type !== "property" || resource.ref == null || resource.ref === "") {
      return deny("resource_required");
    }
    if (!env || !env.DB) return deny("resource_lookup_failed");
    try {
      resolved = await resolveListing(env, resource.ref);
    } catch (err) {
      return deny("resource_lookup_failed");
    }
    if (actor.type === ACTOR_TYPES.USER) {
      try {
        relationship = await getListingRelationship(env, resolved ? resolved.id : null, actor.accountId);
      } catch (err) {
        return deny("ownership_lookup_failed");
      }
    }
  }

  // 6. Grants públicos (aplican a todo actor, anónimo incluido).
  const publicResult = evaluatePublic(action, resolved);
  if (publicResult) return publicResult;

  // 7. Anónimo: agotadas las vías → DENY.
  if (actor.type !== ACTOR_TYPES.USER) {
    return deny("authentication_required");
  }

  // 8. Grants USER implícito (condiciones de ownership/estado).
  //    Un ALLOW aquí decide; un DENY no agota la vía: los grants
  //    de rol global se evalúan después (p.ej. ADMIN archiva un
  //    listing ajeno sin relationship; 04.4 §12).
  const userResult = evaluateUserAction(actor, action, resolved, relationship);
  if (userResult && userResult.decision === DECISION.ALLOW) return userResult;

  // 9. Grants por rol global (user_roles current, server-side).
  const roleResult = evaluateRoleGrants(actor, action, resolved);
  if (roleResult) return roleResult;
  if (userResult) return userResult;

  // 10. Deny-by-default.
  return deny("no_matching_policy", { resource: resolved, relationship });
}
