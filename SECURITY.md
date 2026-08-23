# SECURITY — NEXO

## Modelo de autenticación

| Plano | Mecanismo | Scope |
|---|---|---|
| **Usuario público** | cookie `__Host-session` (HttpOnly; Secure; SameSite=Lax; Path=/; sin Domain) — token 256-bit base64url; D1 almacena sólo SHA-256 hex | registro, login, favoritos |
| **Admin** | header `Authorization: Bearer ADMIN_TOKEN` (timing-safe en worker) | CRUD inmuebles, imágenes, CSV |

El usuario público **nunca** accede al plano admin (aislamiento verificado por tests).

## Passwords
PBKDF2-SHA256, 100 000 iteraciones (límite del runtime de Workers), salt
128-bit por hash, comparación constante en tiempo. Formato
`pbkdf2$iters$salt$hash` (`src/auth/passwords.js`).

## Sesiones (04.3)
- Rotación al autenticarse y revocación por `revoked_at` (audit trail).
- Absoluta 30d; idle no implementado (schema no tiene columna de actividad).
- Concurrencia máx. 5 sesiones/cuenta (la 6ª revoca la más antigua, fail-open).
- Cambio de privilegios ⇒ `security_stamp` rotation + `revokeAllSessions`.
- CSRF: `isStateChangingAllowed` con allowlist de Origin (`"null"` rechazado).

## Autorización (04.5)
Módulo `src/auth/authorization/` con `authorize(actor, action, resource)`
deny-by-default / fail-closed. Ninguna lógica de decisión en endpoints.
Serialización whitelist por audiencia (public/owner/moderator/admin).

## Headers (04.2.1)
- CSP hash-based (script-src sin `unsafe-inline`), generado por
  `scripts/generate-csp-hashes.mjs` desde `public/` (12 hashes actuales).
- HSTS (preload), X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Permissions-Policy restrictiva, Referrer-Policy estricta, COOP/CORP.
- Excepción documentada: `style-src 'unsafe-inline'` (Leaflet inyecta estilos).

## Datos y privacidad
- La respuesta pública de `/api/properties` **nunca** expone PII del owner
  (`owner_name`, `owner_phone`, `internal_notes`, `address`) — doble barrera
  (SELECT explícito + serializer).
- IPs en rate-limit: hash SHA-256 truncada; sesiones guardan `ip_subset`.
- R2: validación MIME + 5MB máx. en `POST /api/admin/upload-image`.

## Reporte de vulnerabilidades
Abrir un issue en el repo o contactar al mantenedor. No exponer detalles
en público hasta que exista un fix desplegado.
