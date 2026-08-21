# NEXO — SESSION RUNTIME (04.3)

Runtime de sesiones server-side sobre el schema Identity FROZEN.
Implementa **continuidad de estado autenticado** — nada más.
Authentication (WHO ARE YOU) y Authorization (WHAT CAN YOU DO) son
fases separadas y NO están implementadas aquí.

## 1. Modelo

```
Client → Cookie __Host-session → Worker
       → SHA-256(token) [hex]
       → D1 sessions lookup (token_hash, partial UNIQUE index)
       → validación (revoked / expires / account status / stamp)
       → contexto { authenticated, accountId, sessionId }
```

El token de sesión **nunca** se almacena en plaintext, nunca viaja en
respuestas de API y nunca se loguea. D1 solo contiene su digest.

## 2. Token lifecycle

- **Generación**: 32 bytes (256 bits) de `crypto.getRandomValues`
  codificados en base64url (43 caracteres). No derivable de
  `account_id`, timestamps ni email. Sin librerías externas.
- **Almacenamiento**: `token_hash = SHA-256(token)` en hex canónico
  (64 chars). Lookup por igualdad exacta sobre
  `idx_sessions_token_hash` (partial UNIQUE `WHERE revoked_at IS NULL`).
  La comparación de hex de igual longitud con `===` es canónica; el
  digest almacenado lo deriva el servidor, nunca el cliente.
- **Cookies duplicadas**: el runtime itera todos los candidatos válidos
  (parser estricto: nombre exacto + valor `^[A-Za-z0-9_-]{43}$`) y usa
  el primero que resuelva a una sesión válida.

## 3. Cookie policy

```
__Host-session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/
```

- Prefijo `__Host-`: exige Secure, sin Domain y Path=/ — la
  topología actual (Worker en apex `*.workers.dev`, mismo origen para
  frontend y API) lo permite.
- **Sin `Domain`**: cookie host-only, inyectable por ningún subdominio.
- **SameSite=Lax** (decisión documentada): bloquea el envío cross-site
  en POST (base anti-CSRF) pero permite navegaciones top-level GET —
  necesario para magic links (04.6), enlaces compartidos por WhatsApp y
  SEO externo. `Strict` rompería la sesión al llegar desde esos enlaces.
- La sesión NO vive en localStorage, sessionStorage, IndexedDB ni
  Cache Storage. El navegador gestiona la cookie; JS no la lee.
- Limpieza (logout): `__Host-session=; …; Expires=Thu, 01 Jan 1970
  00:00:00 GMT`.

## 4. Expiration

- **Absolute**: 30 días fijos desde `created_at` (`expires_at`,
  validado con `>` estricto contra `now`).
- **Idle**: NO implementada — limitación del schema FROZEN. La tabla
  `sessions` no tiene columna de actividad (`last_seen_at` es solo
  auditoría, rolling con throttle de 15 min vía `waitUntil`, fuera del
  critical path). Implementar idle 7d (04.0) requeriría una migration
  nueva; queda diferido y documentado aquí.

## 5. Revocation

- `revokeSession(sessionId)` — individual, marca `revoked_at`.
- `revokeSessionByToken(token)` — usada por logout; idempotente.
- `revokeAllSessions(accountId)` — global por cuenta (recovery,
  compromiso, cambio de security stamp).
- Nunca DELETE: `revoked_at` preserva el audit trail.
- **Concurrencia**: máximo 5 sesiones activas por cuenta (04.0). Al
  crear la 6ª, se revocan las más antiguas
  (`ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 5`).
  Fail-open ante error de conteo (disponibilidad).

## 6. Rotation

`rotateSession(request, env, ctx)`:
1. valida la sesión actual;
2. crea token + sesión nuevos (nuevo `id`, nuevo `token_hash`);
3. revoca la sesión anterior;
4. devuelve la nueva cookie.

La sesión vieja queda inutilizable (anti-replay). **Fixation**: ningún
session identifier provisto por el cliente se acepta jamás; los ids y
tokens se generan siempre server-side. Authentication (futura) llamará
`createSession` tras verificación y `rotateSession` en cambios de
privilegio/recovery.

## 7. CSRF

Estrategia (04.2 §20): **SameSite=Lax + Origin allowlist** para métodos
mutantes (`isStateChangingAllowed`).

- Origin presente → debe igualar el origen del deployment (allowlist
  explícita; localhost solo en dev). Sin suffix-matching.
- `Origin: null` (string) → **rechazado** para operaciones sensibles.
- Origin ausente → aceptado: clientes same-origin no siempre lo envían
  y SameSite=Lax ya bloquea el envío cross-site de la cookie.
- Nunca se confía en Referer como mecanismo primario.
- Un 403 CSRF no revoca ni toca estado.

## 8. CORS

- Allowlist explícita existente (04.2.1); no se reflejan orígenes
  arbitrarios; nunca `*`.
- `Access-Control-Allow-Credentials: true` **solo** en `/api/session/*`
  y solo para orígenes de la allowlist. El resto de la API pública no
  anuncia credenciales (minimiza superficie).
- Admin (`/api/admin/*`) sigue sin CORS.

## 9. Endpoints (superficie mínima)

| Endpoint | Método | Respuesta |
|---|---|---|
| `/api/session/status` | GET | `{ authenticated: false }` o `{ authenticated: true, accountId }` |
| `/api/session/logout` | POST | `{ ok: true }` + Set-Cookie de limpieza |

- **Anti-enumeración**: sesión inexistente, inválida, revocada,
  expirada o cuenta no activa producen respuestas indistinguibles.
- `status` expone únicamente el booleano y el account id opaco (no
  email, no token, no hash, no stamp, no sessionId, no roles).
- Ambos integran el rate limiting existente (sin sistema paralelo).
- NO existen: login, signup, passkey, magic-link, oauth, recovery.

## 10. Cache security

- Respuestas de sesión: `Cache-Control: no-store, no-cache,
  must-revalidate` (`NO_CACHE_HEADERS`); la baseline 04.2.1 respeta
  políticas ya establecidas por el handler (no las pisa).
- **Service worker**: `/api/session/*` excluido explícitamente del
  fetch handler — la Cache API **no** respeta `no-store`; sin la
  exclusión, el SW cachearía estado autenticado. El SW nunca ve el
  token (viaja en cookie HttpOnly).
- Ninguna respuesta autenticada puede terminar en caché público
  (CORP `same-origin` + `no-store` + baseline).

## 11. Admin separation

La sesión de usuario NO autentica rutas `/api/admin/*`. Admin sigue
siendo Bearer `ADMIN_TOKEN` (timing-safe). Una cookie de sesión válida
no otorga privilegios administrativos ni interfiere con el Bearer.

## 12. Account status & security stamp

- Cuenta debe estar `status = 'active'`; `suspended`/`deleted` → no
  autenticado (los estados existen en el schema; no se inventaron).
- `security_stamp`: la sesión no lo persiste (auditabilidad de la
  revocación individual). Clientes que conservan el stamp observado al
  autenticarse pueden presentarlo en `X-Security-Stamp`; si difiere del
  actual de la cuenta, la sesión se invalida (revocación global
  efectiva tras cambio de stamp). Omitir el header no invalida —
  comportamiento opt-in documentado para la fase de Authentication.
- `revokeAllSessions` cubre la invalidación global directa por cuenta.

## 13. Rendimiento D1

- Validación: 1 SELECT (JOIN sessions×accounts) indexado por
  `token_hash` (partial UNIQUE) — columnas mínimas, sin `SELECT *`,
  sin N+1.
- Escrituras: solo en create/revoke/rotate; `last_seen_at` con throttle
  y `waitUntil` (no bloquea la respuesta).
- Sin dependencias de terceros: Web Crypto nativa de Workers.

## 14. Cleanup (estrategia futura)

Sin cron en esta fase. Estrategia documentada: un Cron Trigger diario
que ejecute `DELETE FROM sessions WHERE expires_at < datetime('now',
'-30 days') AND revoked_at IS NOT NULL` (o ventana equivalente),
preservando un margen de auditoría. Las sesiones expiradas/revocadas
no son válidas aunque persistan; la limpieza es higiene, no seguridad.

## 15. Handoff a Authentication (futura)

Contrato 04.2 §11/§31: Authentication emite `AuthSuccess`
(`account_id`, `auth_method`, `security_stamp`, `amr`,
`request_context`) y el runtime materializa:

```js
const { token, sessionId, cookie } = await createSession(env, auth.account_id, {
  userAgent, ipSubset, deviceLabel,
});
// responder con Set-Cookie: cookie; jamás devolver `token` en JSON
```

Authentication no crea cookies, no decide TTL, no consulta permisos.
Authorization (04.4) consumirá `accountId` del contexto y resolverá
roles desde `user_roles` — fuera de este runtime.

## 16. Riesgos residuales documentados

1. **Idle expiration ausente** (schema): una sesión robada es válida
   hasta 30d o revocación explícita. Mitigación: revocación global por
   `security_stamp`/`revokeAllSessions`, límite de concurrencia.
2. **Sin isolate cache** (ADR-002 lo permite ≤35s): 1 lectura D1 por
   request validado. Aceptable al volumen actual; reevaluar con métricas.
3. **`ip_subset`/user_agent se registran pero no se enforce-an**
   (binding estricto de sesión a IP rompería móviles cubanos con NAT
   cambiante; documentado como trade-off).
4. **Origin ausente aceptado** en mutantes: clientes non-browser
   podrían invocar logout sin Origin. Impacto: logout forzado (DoS
   menor), sin fuga ni escalada; SameSite=Lax cubre el vector browser.
