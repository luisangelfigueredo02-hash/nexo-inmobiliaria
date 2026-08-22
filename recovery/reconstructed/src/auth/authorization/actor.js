/* =========================================================
   NEXO — ACTOR RESOLUTION (04.5)
   Construye el actor EXCLUSIVAMENTE desde fuentes server-side:
   - Plano usuario: Session Runtime (04.3) + user_roles current.
   - Plano admin legado: gate Bearer del propio Worker.
   - Plano system: procesos cerrados del servidor (ninguno hoy).

   Una petición HTTP JAMÁS puede declarar rol, accountId, tipo
   de actor ni plane: body/query/headers/cookies se ignoran.
========================================================= */

import { getAuthenticatedSession } from "../../../session-runtime.js";
import { ACTOR_TYPES, anonymousActor } from "./roles.js";
import { LEGACY_ADMIN_PLANE } from "./matrix.js";

export { anonymousActor };

// Actor del plano admin legado (04.4 §7): actor_type='system',
// sin accountId (no hay account que poner; no se falsifica).
export function legacyAdminActor() {
  return { type: ACTOR_TYPES.SYSTEM, accountId: null, sessionId: null, roles: [], plane: LEGACY_ADMIN_PLANE, rolesError: false };
}

// Resuelve sesión + roles globales vigentes. Error en el lookup
// de roles NO degrada a anónimo ni permite nada: marca
// rolesError y authorize() deniega todo (fail-closed, 04.4 §16).
export async function resolveActor(request, env, ctx = null) {
  const session = await getAuthenticatedSession(request, env, ctx);
  if (!session.authenticated) return anonymousActor();

  const actor = {
    type: ACTOR_TYPES.USER,
    accountId: session.accountId,
    sessionId: session.sessionId,
    roles: [],
    plane: null,
    rolesError: false,
  };
  try {
    const { results } = await env.DB.prepare(
      "SELECT role FROM user_roles WHERE account_id = ? AND revoked_at IS NULL"
    ).bind(session.accountId).all();
    actor.roles = (results || []).map(r => r.role).filter(Boolean);
  } catch (err) {
    actor.rolesError = true;
  }
  return actor;
}
