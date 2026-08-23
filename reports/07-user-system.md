# FASE 07 — Sistema de usuarios

**Objetivo:** registro/login/logout/sesión/perfil/favoritos públicos y aislamiento admin.

## Decisión técnica documentada
La spec 04.0 definía **passwordless-first** (passkeys + magic link), pero magic
link requiere un proveedor de email **inexistente** en un producto vendible.
Se implementa **email+password PBKDF2-SHA256** (100 000 iters — Workers capa)
vía WebCrypto, sin dependencias. PBKDF2 en formato `pbkdf2$iters$salt$hash`.

## Estado inicial
`accounts`/`profiles`/`sessions` existían vacías; favoritos legacy (`favorites`
`user_favorites`) referían la tabla obsoleta `users` — se ignoran.

## Cambios (VERIFIED en producción)
- Migration **0006**: `accounts.password_hash` + `account_favorites`
  (account_id TEXT, listing_id INTEGER → properties, UNIQUE).
- `src/auth/passwords.js`: hash/verify/timing-safe/isPasswordValid.
- worker.js: `POST /api/auth/register` (409 duplicado, 400 email/password),
  `POST /api/auth/login` (401 uniforme anti-enumeración), `GET/PUT/DELETE
  /api/me/favorites`; CORS credentials ampliado a `/api/auth/*` y `/api/me/*`.
- `GET /api/session/status`/logout re-usados (04.3).
- `/cuenta/`: página de cuenta (tabs login/registro, vista autenticada con
  favoritos renderizados del catálogo y logout).
- `index.html`: header "Entrar"→"Cuenta" cuando hay sesión; los favoritos
  locales suben al servidor al autenticarse (merge).

## Tests (VERIFIED, 202/202)
9 tests AUTH con mock D1 stateful: register (201), email/password inválidos (400),
duplicado (409), login inválido (401 uniforme), flujo completo
register→login→favorites→logout, favorites no-auth (401), aislamiento admin (401
con cookie), CSRF (403 Origin malicioso).

## Producción (VERIFIED)
register 201 → status authed → PUT fav N-001 → GET favs [N-001] → logout →
status no-auth; login-ok 200 / login-bad 401; admin 401 con cookie de usuario;
CSRF 403; cuenta demo limpiada tras verificar (accounts/sessions/favoritos = 0).

## Riesgos
- Password reset/recovery: **no hay** proveedor de email → recuperación
  imposible sin servidor de email (P1 abierta documentada).
- PBKDF2 100k iters es el techo de Workers (estándar sólido, no OWASP-210k).
