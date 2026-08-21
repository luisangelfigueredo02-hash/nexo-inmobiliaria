/* =========================================================
   NEXO — AUTHORIZATION PERMISSIONS (04.5)
   Catálogo cerrado de permisos atómicos `resource.action`
   (04.4 §3). La matriz rol→permiso es una constante compilada
   (matrix.js): añadir un permiso requiere editar el catálogo,
   la matriz y los tests en el mismo diff.
========================================================= */

export const PERMISSIONS = Object.freeze({
  PROPERTY_READ_PUBLIC: "property.read_public",
  PROPERTY_READ_PRIVATE: "property.read_private",
  PROPERTY_READ_INTERNAL: "property.read_internal",
  PROPERTY_CREATE: "property.create",
  PROPERTY_UPDATE: "property.update",
  PROPERTY_DELETE: "property.delete",
  PROPERTY_SUBMIT: "property.submit",
  PROPERTY_ARCHIVE: "property.archive",

  MODERATION_REVIEW: "moderation.review",
  MODERATION_APPROVE: "moderation.approve",
  MODERATION_REJECT: "moderation.reject",
  MODERATION_REQUEST_CHANGES: "moderation.request_changes",
  MODERATION_SUSPEND_LISTING: "moderation.suspend_listing",

  ACCOUNT_READ: "account.read",
  USER_SUSPEND: "user.suspend",
  ROLE_GRANT_MODERATOR: "role.grant_moderator",
  ROLE_REVOKE_MODERATOR: "role.revoke_moderator",
  LISTING_UNPUBLISH: "listing.unpublish",

  CONFIG_READ: "config.read",
  CONFIG_UPDATE: "config.update",
  AUDIT_READ_OWN: "audit.read_own_actions",
  AUDIT_READ_ALL: "audit.read_all",
});

export const KNOWN_PERMISSIONS = Object.freeze(new Set(Object.values(PERMISSIONS)));

export function isKnownPermission(action) {
  return KNOWN_PERMISSIONS.has(action);
}
