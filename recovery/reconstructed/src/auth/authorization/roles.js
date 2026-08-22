/* =========================================================
   NEXO — AUTHORIZATION ROLES & ACTOR TYPES (04.5)
   PUBLIC/USER son implícitos (sin fila en user_roles).
   OWNER/AGENT son relaciones por listing (listing_owners),
   no roles globales. SUPERADMIN = break-glass (0 en prod).
========================================================= */

export const ACTOR_TYPES = Object.freeze({
  ANONYMOUS: "anonymous",
  USER: "user",
  SYSTEM: "system",
});

export const ROLES = Object.freeze({
  MODERATOR: "MODERATOR",
  ADMIN: "ADMIN",
  SUPERADMIN: "SUPERADMIN",
  AGENCY: "AGENCY", // FUTURE (catálogo cerrado por CHECK en DB)
});

// Relaciones vigentes en listing_owners (ownership ≠ rol).
export const RELATIONSHIPS = Object.freeze({
  OWNER: "owner",
  AGENT: "agent",
  MANAGED_BY: "managed_by", // agencia (FUTURE)
});

// actor = { type, accountId, sessionId, roles, plane }
// Jamás contiene raw tokens, passwords ni secretos; proviene
// exclusivamente de Session Runtime (user) o de un gate
// server-side del propio Worker (system).
export function anonymousActor() {
  return { type: ACTOR_TYPES.ANONYMOUS, accountId: null, sessionId: null, roles: [], plane: null, rolesError: false };
}
