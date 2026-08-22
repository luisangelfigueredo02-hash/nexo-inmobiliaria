/* =========================================================
   NEXO — PERMISSION MATRIX (04.4 §12, FROZEN)
   Fuente única rol→permiso (constante compilada). Deny-by-
   default: ausencia de grant = DENY. Sin herencia jerárquica:
   los grants de ADMIN se listan explícitamente. Las
   condiciones (relationship/estado) se evalúan en authorize().
========================================================= */

import { PERMISSIONS } from "./permissions.js";
import { ROLES } from "./roles.js";

// Grants al alcance de cualquier actor (anónimo incluido).
export const PUBLIC_GRANTS = Object.freeze([
  PERMISSIONS.PROPERTY_READ_PUBLIC,
  PERMISSIONS.CONFIG_READ,
]);

// Grants del rol implícito USER (cuenta autenticada). Las
// acciones sobre listings exigen relación vigente (owner/agent)
// y/o estado elegible; authorize() las valida server-side.
export const USER_GRANTS = Object.freeze([
  PERMISSIONS.PROPERTY_CREATE,
  PERMISSIONS.PROPERTY_READ_PRIVATE,
  PERMISSIONS.PROPERTY_UPDATE,
  PERMISSIONS.PROPERTY_DELETE,
  PERMISSIONS.PROPERTY_SUBMIT,
  PERMISSIONS.PROPERTY_ARCHIVE,
]);

const MODERATION_ACTIONS = [
  PERMISSIONS.MODERATION_REVIEW,
  PERMISSIONS.MODERATION_APPROVE,
  PERMISSIONS.MODERATION_REJECT,
  PERMISSIONS.MODERATION_REQUEST_CHANGES,
  PERMISSIONS.MODERATION_SUSPEND_LISTING,
];

// Grants por rol global (user_roles current). ADMIN incluye
// explícitamente las capacidades de moderación (grant explícito
// en la matriz §12, no herencia jerárquica).
export const ROLE_GRANTS = Object.freeze({
  [ROLES.MODERATOR]: Object.freeze([
    ...MODERATION_ACTIONS,
    PERMISSIONS.PROPERTY_READ_INTERNAL,
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.AUDIT_READ_OWN,
  ]),
  [ROLES.ADMIN]: Object.freeze([
    // Capacidades de moderación (grant explícito, §12).
    ...MODERATION_ACTIONS,
    PERMISSIONS.PROPERTY_READ_INTERNAL,
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.AUDIT_READ_OWN,
    // Capacidades administrativas (§12).
    PERMISSIONS.USER_SUSPEND,
    PERMISSIONS.ROLE_GRANT_MODERATOR,
    PERMISSIONS.ROLE_REVOKE_MODERATOR,
    PERMISSIONS.LISTING_UNPUBLISH,
    PERMISSIONS.PROPERTY_ARCHIVE,
    PERMISSIONS.CONFIG_UPDATE,
    PERMISSIONS.AUDIT_READ_ALL,
  ]),
  // SUPERADMIN: break-glass únicamente, 0 cuentas en producción.
  // Ningún grant operativo diario (04.4 §8).
  [ROLES.SUPERADMIN]: Object.freeze([]),
  // AGENCY: FUTURE (04.4 §14); sin grants en MVP.
  [ROLES.AGENCY]: Object.freeze([]),
});

// Plano admin legado (Bearer ADMIN_TOKEN → actor_type='system',
// plane='legacy_admin_bearer'; 04.4 §7). Lista cerrada y
// enumerada de acciones del panel actual. Su migración al rol
// account-based ADMIN ocurrirá en una fase posterior con ADR
// propio; hasta entonces opera como deuda documentada y cada
// acción audita con metadata.admin_plane='legacy_bearer'.
export const LEGACY_ADMIN_PLANE = "legacy_admin_bearer";
export const LEGACY_ADMIN_PLANE_ACTIONS = Object.freeze([
  PERMISSIONS.PROPERTY_READ_INTERNAL,
  PERMISSIONS.PROPERTY_CREATE,
  PERMISSIONS.PROPERTY_UPDATE,
  PERMISSIONS.PROPERTY_DELETE,
]);
