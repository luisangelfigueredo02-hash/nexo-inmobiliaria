# NEXO — 04.2 AUTHENTICATION ARCHITECTURE SPECIFICATION

**ESTADO: FROZEN.** Arquitectura de autenticación de NEXO. Sin código, sin
endpoints, sin UI. Contrato para 04.3 (Sessions) y 04.4 (Authorization).

Base: 04.0 Identity Architecture, 04.1 Identity Database Foundation,
04.1-FIX Identity Schema Integrity (**IDENTITY SCHEMA FROZEN**).

---

## §1. INVESTIGACIÓN DEL ENTORNO ACTUAL

| Componente | Estado actual | Relevancia auth |
|---|---|---|
| Worker (`worker.js`) | Admin auth: Bearer `ADMIN_TOKEN` timing-safe compare, fallback legacy `ADMIN_PASSWORD` (deprecable). Rutas `/api/admin/*`. | Admin auth existente, separado por diseño. |
| Rate limiting (`rate-limit.js`) | IP-based vía D1 `rate_limits`, SHA-256 de IP, solo `/api/chat` (20 req/ventana). | Infra reutilizable para auth endpoints (nuevos límites por acción). |
| Security headers | **Ausentes**: sin CSP, sin HSTS, sin X-Frame-Options, sin Referrer-Policy. | GAP documentado (§19): requeridos antes de auth. |
| CORS | Orígenes permitidos explícitos; admin sin CORS. | Compatible con cookies SameSite. |
| PWA | `manifest.json`, `sw.js` offline-first ("Modo Isla"). | Auth debe tolerar offline/intermitente (§23). |
| D1 Identity | Schema FROZEN: `accounts`, `profiles`, `roles`, `user_roles`, `sessions` (token_hash UNIQUE partial), `listing_owners`, `moderation_events`, `audit_events`. | Base suficiente; NO requiere cambios para 04.2. |
| Auth endpoints | **Ninguno** `/api/auth/*`. | Clean slate. |
| Email infra | **No existe** proveedor de email. | Magic link requiere decisión de proveedor (open). |

**Capacidades existentes reutilizables**: timing-safe compare, D1 rate-limit
pattern con hash de IP, CORS allowlist, audit_events con correlation_id.

---

## §2. PRINCIPIO DE AUTENTICACIÓN

**PASSWORDLESS-FIRST** (confirmado ADR-001 04.0). Ningún password como
mecanismo primario. `accounts.password_hash` fue eliminado en 04.1-FIX
(ADR-011): no existe vía de password en el schema congelado.

Evaluación rigurosa de opciones en §3–§6; decisión en §25–§26.

---

## §3. PASSKEYS / WEBAUTHN

### 3.1 Tecnología
WebAuthn Level 2/3 (CTAP2). Platform authenticators:
- **iOS 16+**: Face ID / Touch ID, credenciales sincronizadas vía iCloud Keychain.
- **Android 9+**: huella/PIN, credenciales vía Google Password Manager (sync) o device-bound.
- **Chrome/Edge desktop**: Windows Hello, o cross-device (QR + Bluetooth "cable"/hybrid transport).
- **Safari 16+ (macOS)**: Touch ID.

### 3.2 UX
- Un toque biométrico ≈ 2–4 segundos. Sin typing, sin copy/paste, sin salir de la app.
- Synced passkeys: mismo passkey disponible en todos los dispositivos del usuario (iCloud/Google).
- Cross-device: QR scan para autenticar desktop con el móvil (relevante: usuario cubano con móvil Android + PC compartido).

### 3.3 Seguridad
- **Phishing-resistant**: la credencial está ligada al RP ID (dominio); un phishing en dominio falso no puede usarla.
- Ningún secreto compartido con el servidor: solo clave pública + attestation.
- Resistente a credential stuffing: no hay nada que "stuffear".
- Replay protection nativa: challenge de un solo uso, contador de firma (signCount).

### 3.4 Failure modes
| Fallo | Comportamiento |
|---|---|
| Dispositivo sin WebAuthn (browser viejo) | Fallback a Magic Link (§4). |
| Passkey perdida (dispositivo perdido/roto) | Recovery por Magic Link → nueva passkey. |
| iCloud/Google sync deshabilitado | Credencial device-bound; recovery por Magic Link. |
| Attestation no verificable | `attestation: "none"` (no exigimos attestation de hardware; reduce fricción, aceptable para inmobiliaria). |
| userVerification failure | Reintentar; caer a Magic Link. |

### 3.5 Recovery
Passkey **no** es self-recovering. La recuperación canónica: Magic Link al
email verificado → sesión → re-registrar passkey nueva y revocar las viejas
(§12, §14).

### 3.6 Veredicto
**Viable como método primario** para NEXO: UX Tier 1 móvil, seguridad Tier 1
(phishing-resistant), soporte amplio en iOS/Android modernos, y Cuba no
introduce restricción técnica (WebAuthn es local + sync cloud de Apple/Google,
no depende de servicios bloqueados regionalmente).

**No asumimos que todos los usuarios tienen passkeys**: Magic Link es el
path universal de bootstrap y el fallback permanente (no "modo degradado"
temporal, sino ciudadano de primera clase).

---

## §4. MAGIC LINK

### 4.1 Rol en NEXO
Método de **bootstrap** (primera cuenta / primer dispositivo sin passkey) y
**recovery** (pérdida de passkey/dispositivo). También método completo de
login para usuarios que nunca registren passkey.

### 4.2 Diseño de token
- **Generación**: `crypto.getRandomValues(32 bytes)` → 256 bits de entropía, base64url.
- **Almacenamiento**: jamás plaintext. `token_hash = SHA-256(token)` en D1 (tabla dedicada `auth_tokens` — definida en spec, a crear en fase de implementación; NO en esta fase).
- **Expiración**: TTL ≤ 15 minutos (ADR-006 04.0).
- **Single-use**: consumo atómico (`UPDATE ... SET used_at WHERE token_hash=? AND used_at IS NULL`; si 0 rows → inválido).
- **Replay protection**: single-use + TTL + binding a purpose (`purpose IN ('bootstrap','login','recovery')`).
- **Rotación de seguridad**: al consumirse recovery → `security_stamp` nuevo + revocación global de sesiones (04.1 schema soporta ambos).

### 4.3 Entrega
- Email delivery: proveedor pendiente (open question 04.0 — candidatos tipo
  Cloudflare Email Routing + MailChannels/Resend; **decisión diferida a
  implementación**, NO en esta fase).
- Email bombing / spam: rate limit estricto (§10) + cooldown por email.
- No se envían emails todavía; no se implementa proveedor.

### 4.4 Email enumeration
Respuestas uniformes (§8). Timing normalizado.

### 4.5 Phishing considerations
- Magic link ≠ phishing-resistant (un link reenviado funciona). Mitigaciones:
  TTL corto, single-use, binding a `purpose`, notificación de login nuevo (opcional 04.0), y — clave — el objetivo es que el usuario migre a passkey tras bootstrap.
- El magic link abre sesión en el dispositivo que lo abre; el atacante con el
  email robado puede pedir link → mitigado por rate limit + uniformidad +
  TTL + notificación al usuario.

### 4.6 Mobile deep links / browser handoff
- PWA: `https://nexo.../auth/consume?t=...` abre en el browser; si la PWA está
  instalada, se usa scope del manifest para handoff. Universal Links (iOS) /
  App Links (Android) requieren app nativa — **fuera de scope PWA pura**;
  con PWA el handoff es vía mismo browser del sistema que abre el email.
- Riesgo: si el usuario abre el link en un browser distinto del que pidió el
  link, la sesión se crea en el browser que consume (diseño intencional;
  no binding a browser original para no romper UX en Cuba).

### 4.7 Session establishment
Tras consumo válido: Authentication SUCCESS → handoff a 04.3 con contrato
mínimo (§11).

---

## §5. EMAIL OTP

| Dimensión | Magic Link | Email OTP |
|---|---|---|
| UX móvil | 1 tap | Abrir email, memorizar/copiar 6 dígitos, volver, teclear (peor) |
| Entrega | Igual infra | Igual infra |
| Seguridad | Token 256-bit, single-use | Código 6 dígitos (10⁶ espacio) — fuerza bruta plausible sin lockout estricto |
| Brute force | N/A (256 bits) | Requiere lockout por intentos + rate limit agresivo |
| Enumeration | Mitigable | Mitigable igual |
| Usabilidad Cuba (red lenta) | Tolerante: el link espera | Peor: el usuario alterna app/email con red lenta |

**Veredicto**: Email OTP es **inferior** para NEXO en UX móvil y seguridad
por entropía. **Rechazado** como mecanismo. No se implementa salvo decisión
explícita posterior (p.ej. si un futuro canal exige verificación in-app sin
salir). Documentado como alternativa evaluada.

---

## §6. OAUTH

| Dimensión | Evaluación Cuba/NEXO |
|---|---|
| Disponibilidad regional | Google/Apple OAuth funciona, pero añade dependencia de terceros en flujos de red ya frágiles; Facebook tiene presencia pero no es canónico para identidad seria. |
| Dependencia terceros | Alta: si el IdP falla/bloquea, el usuario no entra. |
| Account linking | Requiere matching por email verificado — complejidad extra. |
| Recovery | Delegada al IdP (bien) pero opaca. |
| Privacidad | Comparte actividad de login con terceros. |
| Costes | Gratis, pero vendor lock-in de identidad. |

**Veredicto**: **Opcional futuro (fase posterior), no MVP, no requerido.**
La ausencia de OAuth **no degrada** la arquitectura: passkey + magic link
cubren el 100% de los casos sin dependencias externas. Si se añade, será
como authenticator adicional vinculado a `accounts` existente por email
verificado (account linking deliberado, nunca auto-merge silencioso).

---

## §7. AUTHENTICATION MODEL — FLUJOS

### 7.1 NEW USER
```
NEW USER
  → IDENTIFICATION: introduce email (form uniforme)
  → BOOTSTRAP: Magic Link enviado (respuesta uniforme, exista o no)
  → VERIFICATION: consume link (token 256-bit, single-use, ≤15min)
  → ACCOUNT CREATION: accounts.id (ULID/UUID), email_verified_at=now
  → AUTHENTICATOR REGISTRATION (opcional, recomendado): registrar passkey
  → SESSION CREATION: handoff a 04.3
  → AUTHORIZED EXPERIENCE (04.4)
```

### 7.2 RETURNING USER
```
RETURNING USER
  → AUTHENTICATOR:
     a) Passkey (primario): navigator.credentials.get() → verify assertion
     b) Magic Link (fallback): email → link → consume
  → SESSION: handoff a 04.3
  → AUTHORIZED EXPERIENCE (04.4)
```

### 7.3 ACCOUNT RECOVERY
```
ACCOUNT RECOVERY (dispositivo perdido / passkey perdida)
  → IDENTIFICATION: email
  → VERIFICATION: Magic Link (purpose='recovery', TTL ≤15min)
  → RECOVERY: consume → revocación global de sesiones + security_stamp nuevo
  → NEW AUTHENTICATOR: re-registrar passkey(s), revocar passkeys antiguas
  → SESSION CREATION
```
La recuperación es deliberadamente **más pesada** que el login: revoca todo,
exige re-registrar authenticator, y notifica (observability §30).

---

## §8. ACCOUNT ENUMERATION

La API **nunca** revela existencia de email.

- **Respuesta uniforme**: para `magic-link request`, `bootstrap`, `recovery`:
  siempre `202 Accepted` + cuerpo idéntico ("si el correo está registrado,
  recibirás un enlace"), HTTP idéntico, headers idénticos.
- **Timing**: trabajo constante — la rama "email no existe" realiza un hash
  dummy + mismo delay mínimo (p.ej. `Promise.all([hash, sleep(jitter)])`)
  para igualar la rama real que escribe D1 + envía email.
- **Passkey login**: WebAuthn `discoverable credentials` (resident keys)
  evitan pedir email primero: el authenticator devuelve user handle sin
  revelar existencia por API. Si se usa non-resident flow con email primero,
  la respuesta de "challenge" también es uniforme (challenge dummy).
- **Rate limiting** como segunda línea (§10): enumeration masiva queda
  limitada por IP aunque la respuesta sea uniforme.

---

## §9. TOKEN SECURITY

| Propiedad | Regla |
|---|---|
| Aleatoriedad | `crypto.getRandomValues` (WebCrypto), ≥ 128 bits (usamos 256) |
| Almacenamiento | Solo `SHA-256(token)` en D1; **jamás plaintext** |
| Single-use | Consumo atómico condicional en D1 |
| Expiración | TTL ≤ 15 min (magic/recovery); challenge WebAuthn ≤ 5 min |
| URL post-consumo | El token viaja en query param 1 vez; tras consumo, la app navega a ruta limpia (`history.replaceState`) — el token no persiste en history/storage |
| Passkeys | Sin tokens de sesión WebAuthn: assertion verificada contra challenge one-time |

Schema actual (`sessions.token_hash`, UNIQUE partial) ya impone hash-only en
sesiones (04.1-FIX). La tabla `auth_tokens` (futura fase implementación)
seguirá el mismo patrón.

---

## §10. AUTHENTICATION RATE LIMITING

Límites por acción (D1 `rate_limits` pattern existente, ventana deslizante,
IP hasheada SHA-256 como en `rate-limit.js`). Valores iniciales (ajustables):

| Acción | Límite IP | Límite por cuenta/email | Ventana |
|---|---|---|---|
| Magic link request | 5 | 3 (por email hasheado) | 10 min |
| Bootstrap/register | 5 | 3 | 10 min |
| Passkey auth challenge | 10 | 10 | 10 min |
| Passkey registration | 5 | 5 | 10 min |
| Recovery request | 3 | 2 | 10 min |
| Token consume | 10 | 5 | 10 min |
| Session creation | 20 | 20 | 10 min |

- **IP-based**: ya existe el patrón (hash, no plaintext IP).
- **Account-based**: email/account hasheado (mismo patrón privacy).
- **Lockout progresivo**: tras N violaciones, cooldown exponencial por clave.
- **Nunca** confiar en frontend throttling: todo enforcement server-side.
- Integración futura con Cloudflare Turnstile en formularios de email
  (anti-bot), decisión de implementación — no en esta fase.

---

## §11. SESSION BOUNDARY (contrato 04.2 → 04.3)

Authentication entrega a Sessions **únicamente**:

```
AuthSuccess {
  account_id: TEXT,        // ULID/UUID existente
  auth_method: 'passkey' | 'magic_link',
  security_stamp: TEXT,    // valor actual (04.3 lo valida por request)
  amr: ['webauthn'] | ['email_link'],
  request_context: { ip_subset, user_agent }  // bounded, privacy-aware
}
```

- Authentication **no** crea la cookie/token de sesión ni decide su TTL:
  eso es 04.3. Solo emite `AuthSuccess` y 04.3 materializa la sesión
  (fila en `sessions` con token_hash, expires_at).
- Authentication **no** consulta permisos: eso es 04.4.
- Frontera estricta: Authentication = WHO ARE YOU; Sessions = continuity;
  Authorization = WHAT CAN YOU DO.

---

## §12. ACCOUNT RECOVERY (sin contraseña)

| Escenario | Flujo |
|---|---|
| Lost device (passkey synced) | Login normal en dispositivo nuevo: la passkey synced (iCloud/Google) ya está disponible → WebAuthn directo. |
| Lost device (passkey device-bound) | Magic Link recovery → sesión → registrar passkey nueva → revocar passkeys del dispositivo perdido. |
| Lost passkey (mismo dispositivo) | Magic Link recovery → re-registrar. |
| Changed email | Flujo de cambio de email autenticado (sesión válida + link de confirmación al email nuevo y notificación al viejo). No implementado aún; spec: requiere sesión activa + verification link doble. |
| Compromised email | Riesgo dominante (04.0 ADR-006): atacante puede pedir recovery. Mitigación: TTL corto, single-use, revocación global al usar recovery, notificación opcional, y — defensa clave — passkey sigue siendo el authenticador primario; recovery por email **revoca sesiones pero exige re-registrar passkey**, y el usuario legítimo recibe notificación. |
| Multiple devices | Cada dispositivo con su passkey (§15); recovery revoca todo y re-arma. |
| Recovery authenticator | El email verificado ES el recovery authenticator. No hay segundo factor de recovery en MVP (documentado como riesgo residual). |

Recovery es **deliberadamente más difícil de abusar que login**: cooldown
más estricto (§10), revocación global, notificación, y re-registro obligatorio.

---

## §13. ACCOUNT TAKEOVER — THREAT MODEL

| Amenaza | Vector | Mitigación |
|---|---|---|
| Stolen email | Atacante pide magic link/recovery | TTL ≤15min, single-use, rate limit por email+IP, revocación global al recovery, notificación al usuario, re-registro de passkey obligatorio |
| Stolen magic link (reenvío/intercepción) | Token reenviado | Single-use atómico + TTL corto; el consumo es válido una sola vez |
| Phishing | Fake site pide credenciales | **Passkeys son phishing-resistant** (RP ID binding); magic link mitigado por TTL + no-password |
| Token replay | Re-uso de token consumido | `used_at` atómico; replay → inválido |
| Session theft | Robo de cookie/token | 04.3: HttpOnly+Secure+SameSite, rotación, revocación, security_stamp |
| Malicious device | Dispositivo compartido | Sesiones revocables por dispositivo (04.3 listado/cierre), passkey userVerification (biometría) |
| Automated attempts | Bots | Rate limiting §10, uniformidad §8, Turnstile futuro |
| Enumeration | Probar emails | Respuestas uniformes + timing constante + rate limit |
| Social engineering | Soporte falso | Sin recovery por soporte manual sin verificación de email; proceso documentado, sin excepciones |

---

## §14. PASSKEY LIFECYCLE (spec, no implementación)

| Operación | Definición |
|---|---|
| **Registration** | Tras bootstrap magic link o sesión válida: `navigator.credentials.create()` con userVerification=preferred, attestation=none, residentKey=preferred (discoverable). Se almacena: credential_id (hash), public_key, sign_count, device_label opcional, transports, created_at, last_used_at. |
| **Authentication** | `navigator.credentials.get()` con challenge one-time (≤5min); verify assertion + signCount monótono. |
| **Rename** | Solo `device_label` (settings, sesión válida). |
| **List** | Settings: passkeys del account (credential_label, created, last_used). Nunca material privado (no existe en servidor). |
| **Revoke** | Individual (settings) o global (recovery). Registra audit_event. |
| **Lost device** | Recovery → revoke del set asociado (device_label heuristic) o all-passkey revoke. |
| **New device** | Synced passkey: disponible directo. Device-bound: recovery + register. |
| **Recovery** | §12. |

---

## §15. MULTI-DEVICE

- `one account = N authenticators`: passkeys por dispositivo/plataforma +
  magic link universal. Schema soporta múltiples filas de credenciales por
  `account_id` (tabla de credenciales a crear en implementación; accounts PK
  TEXT ya es estable).
- Synced passkeys (iCloud/Google) cubren multi-device dentro del mismo
  ecosistema gratis.
- Cross-ecosystem (iPhone + PC Windows): passkey cross-device (QR) para
  autenticar, y opción de registrar passkey local adicional.
- Settings lista dispositivos/passkeys y sesiones (04.3) con revocación.

---

## §16. ADMIN VS USER AUTHENTICATION

| Dimensión | Admin actual | Public user (04.2) |
|---|---|---|
| Método | Bearer `ADMIN_TOKEN` (timing-safe) | Passkey / Magic Link |
| Scope | `/api/admin/*` | `/api/*` público + cuenta |
| Identidad | Sin account en D1 | `accounts` ULID |
| Rate limit | No dedicado (recomendado añadir) | §10 |

**Decisión**:
- **Separación total**: admin auth actual NO se mezcla con public user auth.
  `ADMIN_TOKEN` sigue siendo el mecanismo admin en esta fase; no se degrada.
- **Coexistencia**: `/api/admin/*` (Bearer) y futuros `/api/auth/*` (public)
  son planos independientes; ningún endpoint acepta ambos esquemas.
- **Migration strategy**: cuando exista auth de usuarios, admin puede migrar
  a accounts con `user_roles.role='ADMIN'` + passkey **obligatoria** (admin
  nunca magic-link-only). Ese paso es 04.4+ con ADR propio; no en 04.2.
- **Privilege boundary**: un Bearer admin token jamás crea sesiones de usuario;
  una sesión de usuario jamás accede a `/api/admin/*` sin rol ADMIN verificado
  por 04.4.

---

## §17. AUTHORIZATION BOUNDARY

- 04.2 entrega **identidad autenticada**: `account_id` + `auth_method` +
  `security_stamp` (§11). Nada más.
- Permisos/roles/ownership = 04.4 (usa `user_roles`, `listing_owners` del
  schema FROZEN).
- Ningún endpoint de auth decide permisos; ningún middleware de auth lee
  `user_roles`. Frontera estricta.

---

## §18. PRIVACY

| Dato | Política |
|---|---|
| PII mínima | Email (identificador) + phone opcional. Nada más en bootstrap. |
| Device info | `device_label` user-provided; `user_agent` **bounded** (truncado); sin fingerprinting invasivo. |
| IP retention | Solo `ip_subset` hasheado/truncado (patrón rate-limit.js); jamás IP cruda persistente. |
| Auth metadata | `auth_method`, timestamps, correlation_id. Sin geolocalización. |
| audit_events | `metadata` JSON sin secretos, sin tokens, sin email crudo salvo necesidad de seguridad (04.0 §13). |

Justificación de seguridad requerida para cualquier dato adicional.

---

## §19. SECURITY HEADERS (requisitos para fases siguientes)

GAP actual: sin CSP/HSTS/etc. Requisitos documentados (a implementar antes de
auth endpoints, fase de implementación — NO ahora):

- **CSP**: `default-src 'self'`; `script-src 'self'`; sin `unsafe-inline` en
  páginas con auth UI; WebAuthn no requiere CSP especial.
- **HSTS**: `max-age=31536000; includeSubDomains` (HTTPS-only; magic links
  y cookies lo exigen).
- **Cookies de sesión (04.3)**: `Secure; HttpOnly; SameSite=Lax; Path=/`.
  `SameSite=Lax` (no Strict) para que el magic link cross-navigation funcione.
- **Referrer-Policy: strict-origin-when-cross-origin** (el token del magic
  link no debe filtrarse por Referer a terceros).
- **X-Content-Type-Options: nosniff**, **X-Frame-Options: DENY** (clickjacking
  en páginas de auth).
- **Origin checks**: verificar `Origin`/`Referer` en POST de auth.
- WebAuthn: RP ID = dominio exacto; `origin` verificado server-side en cada
  ceremony.

---

## §20. CSRF

Sesiones serán cookie-based (04.3) → **CSRF protection obligatoria**:

| Flujo | Estrategia |
|---|---|
| Magic link consume (GET) | Sin estado CSRF propio (es el bootstrap); el token single-use + SameSite=Lax cookie resultante. POST de confirmación opcional con token. |
| Login/passkey ceremonies (POST) | **Origin/Referer validation** estricta + SameSite=Lax. |
| Acciones autenticadas mutantes (POST/PUT/DELETE) | SameSite=Lax + Origin validation + **CSRF token** (double-submit o sincronizado) si se aceptan requests cross-origin en el futuro. |
| GET | Nunca mutan estado (regla arquitectónica). |

Estrategia primaria: **SameSite=Lax + Origin validation** (suficiente para
top-level POST mismo-sitio); CSRF token explícito como defensa adicional en
acciones sensibles (recovery, cambio de email, revocación).

---

## §21. XSS

| Material | Almacenamiento | Impacto XSS |
|---|---|---|
| Passkeys | Clave privada en authenticator (fuera del alcance de JS) | **Inmune a XSS** — ventaja decisiva de passkeys |
| Session token | Cookie `HttpOnly` (04.3) | JS no puede leerla; XSS no exfiltra sesión |
| Magic link token | URL una vez; `history.replaceState` tras consumo; **nunca localStorage** | Ventana mínima |
| Auth UI | CSP estricta (§19), sin inline scripts, escape de templates | Mitigación base |

**Regla**: ningún authentication material en `localStorage`/`sessionStorage`
(la alternativa HttpOnly cookie existe y es superior).

---

## §22. MOBILE UX

- **Passkey**: 1 tap biométrico. Sin copy/paste, sin códigos manuales.
- **Magic link**: email → tap en link → sesión. Sin teclear códigos.
- **Deep links**: PWA pura — el link abre en el browser del sistema y el
  flujo completa allí; si la PWA instalada comparte origen, la sesión aplica
  (mismo storage de cookies del browser).
- **Browser handoff**: documentado §4.6 — sesión se crea donde se consume.
- **iPhone/Android**: WebAuthn nativo en ambos; biometría local.
- Objetivo: **≤2 taps** para login returning (passkey), **≤3** para bootstrap
  (email → link → opcional passkey).

---

## §23. NETWORK CONDITIONS (Cuba)

| Condición | Diseño |
|---|---|
| Slow network | Magic link tolera latencia (el link espera en el email); passkey ceremony es mayormente local (challenge-response corto). |
| Intermittent | Requests idempotentes: magic-link request repetible (misma respuesta uniforme, rate-limited); consume single-use pero re-request genera link nuevo. |
| Retries/duplicates | `request_correlation_id` en audit; consume atómico evita doble-sesión. |
| Timeout | Timeout generoso (≥30s) en fetch de auth; UI con estado `loading` y retry explícito. |
| Offline transition | PWA sw.js ya cachea shell; auth requiere red (documentado: mensaje claro "sin conexión"). Passkey assertion necesita red solo para verify server-side. |

**Idempotency**: magic-link request idempotente por ventana (mismo efecto);
consume NO idempotente por diseño (single-use) con respuesta clara
"link ya usado / expirado" (§29).

---

## §24. ABUSE PREVENTION (Cloudflare-native)

| Abuso | Mitigación |
|---|---|
| Bot registration | Rate limit §10 + Turnstile (futuro) + uniformidad |
| Email bombing | Cooldown por email hasheado (3/10min) + cap global |
| OTP brute force | N/A (no OTP) |
| Magic link spam | Rate limit IP + email + Turnstile futuro |
| Credential stuffing | N/A (sin passwords) — ventaja estructural |
| Account enumeration | Uniformidad + timing constante + rate limit |
| Session abuse | 04.3: rotación, revocación, security_stamp, concurrent limit (5 per 04.0) |

---

## §25. ARCHITECTURAL DECISION

```
PRIMARY AUTHENTICATION:   PASSKEY (WebAuthn platform authenticator)
SECONDARY / RECOVERY:     EMAIL MAGIC LINK (bootstrap + fallback + recovery)
OPTIONAL FUTURE:          OAuth (Google/Apple), Email OTP (solo si se justifica),
                          hardware security keys (FIDO2 cross-platform)
```

**RATIONALE**:
- **Security**: passkey = phishing-resistant, sin secretos compartidos, inmune
  a credential stuffing y a XSS exfiltration. Magic link con tokens 256-bit
  hash-only, single-use, TTL corto.
- **UX**: 1 tap biométrico vs teclear contraseñas/códigos en móvil. Magic link
  = 2 taps sin códigos.
- **Cuba compatibility**: WebAuthn funciona local + sync Apple/Google (sin
  dependencia de servicios bloqueados). Email es el canal más fiable en Cuba
  (vs SMS caro/frágil — ADR-006 04.0).
- **PWA compatibility**: WebAuthn 100% soportado en browser context PWA
  (iOS 16+, Android 9+, Chrome, Safari 16+).
- **Cost**: cero coste por autenticación (passkey local); email barato
  (proveedor por decidir); sin SMS.
- **Operational complexity**: sin password reset flows, sin breached-password
  handling, sin secretos que rotar por cuenta. Email infra = única
  dependencia nueva.
- **Recovery**: magic link recovery → revocación global + re-registro passkey;
  deliberadamente más estricto que login.
- **Scalability**: verificación WebAuthn stateless por ceremony (challenge en
  D1, TTL 5min); D1 aguanta el volumen (mismo patrón que rate_limits).

---

## §26. RECOMMENDED NEXO MODEL — DEMOSTRACIÓN

`PASSKEY-FIRST + EMAIL MAGIC LINK RECOVERY` **es la decisión final** (no
asumida). Demostración técnica:

1. **vs Magic-Link-only**: magic-link-only deja el email como único factor
   permanente; email comprometido = cuenta comprometida. Passkey-first reduce
   la superficie: el email solo se usa en bootstrap/recovery (eventos raros,
   auditados, revocación global).
2. **vs Password+OTP**: passwords → stuffing/phishing/reset flows; OTP →
   brute-force space 10⁶. Ambos inferiores.
3. **vs OAuth-only**: dependencia de tercero; si el IdP bloquea/falla, sin
   acceso. Opcional futuro, no núcleo.
4. **Riesgo principal de passkey-first** (soporte/adopción) → mitigado por
   magic link como fallback permanente de primera clase, no como parche.
5. **Riesgo de recovery-por-email** → mitigado §12/§13 (TTL, single-use,
   revocación global, notificación, rate limit reforzado, re-registro).

Conclusión: la combinación maximiza seguridad y UX con la dependencia mínima
viable (email), alineada con 04.0 ADR-001.

---

## §27. ADR

Creado: **ADR-012 — Authentication Strategy** en
`identity-architecture-adrs.md` (mismo archivo de ADRs del proyecto).

---

## §28. THREAT MODEL (authentication)

| Asset | Threat | Attack | Impact | Mitigation | Residual Risk |
|---|---|---|---|---|---|
| Account identity | Takeover | Stolen email → recovery | Alto | TTL 15min, single-use, revocación global, notificación, rate limit, re-register passkey | Medio (email comprometido + no notificación leída) |
| Magic link token | Replay/theft | Token reenviado/interceptado | Medio | 256-bit entropy, hash-only storage, single-use atómico, TTL | Bajo |
| Passkey credential | Phishing | Fake RP | Alto | RP ID binding nativo WebAuthn (inmune) | Muy bajo |
| Session (handoff) | Theft | Cookie/token robado | Alto | 04.3: HttpOnly/Secure/SameSite, rotación, security_stamp, revocación | Medio (hasta 04.3) |
| Auth endpoints | Brute force/enumeration | Bots, email probing | Medio | Uniformidad §8, timing constante, rate limit §10, Turnstile futuro | Bajo |
| Availability | Email provider down | Login bootstrap imposible | Medio | Passkeys existentes siguen funcionando (sin email); proveedor redundante futuro | Bajo-Medio |
| User trust | Phishing email falso de NEXO | Link a dominio falso | Medio | Dominio consistente, educación, passkey no depende de link | Medio |
| Privacy | IP/device tracking | Retención excesiva | Bajo | ip_subset hasheado, UA bounded, sin fingerprinting | Bajo |

---

## §29. FAILURE STATES

| Estado | Comportamiento definido |
|---|---|
| passkey unavailable | Fallback visible a Magic Link; mensaje claro, sin error técnico. |
| email unavailable (provider down) | Bootstrap/recovery bloqueado con mensaje honesto; passkeys existentes siguen operando; retry manual. |
| timeout | UI `loading` → `error` con retry explícito; request idempotente reintentable (excepto consume). |
| expired token | Respuesta uniforme "enlace no válido o expirado" + ofrecer reenvío (rate-limited). |
| used token | Igual que expirado (no distinguir; anti-enumeration de estado). |
| invalid token | Igual (uniforme). |
| rate limited | HTTP 429 + Retry-After (patrón rate-limit.js existente) + UI con countdown. |
| account locked/restricted (suspended) | Mensaje genérico sin detalle de estado; canal de soporte documentado. |
| device lost | Recovery flow §12; revocación global. |
| recovery initiated | Audit + notificación email "se inició recuperación". |
| recovery completed | Audit + revocación global + re-registro passkey + notificación. |

---

## §30. OBSERVABILITY

Eventos en `audit_events` (append-only, schema FROZEN) con `correlation_id`:

`auth_started`, `auth_success`, `auth_failed`, `magic_link_requested`,
`magic_link_consumed`, `passkey_registered`, `passkey_auth_success`,
`passkey_auth_failed`, `passkey_revoked`, `recovery_started`,
`recovery_completed`, `session_created` (emitido por 04.3), `rate_limited`.

**Jamás registrar**: password (no existen), tokens (ni plaintext ni hash
completo — solo identificador truncado), secretos, private credential
material, email crudo en metadata salvo necesidad de seguridad documentada.

---

## §31. IMPLEMENTATION CONTRACT

### Para 04.3 Sessions
- Entrada: `AuthSuccess` (§11) — account_id, auth_method, security_stamp, amr, request_context bounded.
- 04.3 decide: cookie format, TTL (idle 7d / absolute 30d per 04.0), rotación, revocación, concurrent limit (5), cache de isolate ≤35s.
- 04.3 valida `security_stamp` en cada request (revocación global efectiva).
- 04.2 NO implementa nada de esto.

### Para 04.4 Authorization
- Entrada: `account_id` autenticado (vía sesión válida de 04.3).
- 04.4 usa `user_roles` (current: revoked_at IS NULL), `listing_owners`,
  `properties.created_by` del schema FROZEN.
- 04.2 NO decide permisos.

### Nuevas tablas que la fase de implementación necesitará (NO creadas ahora)
- `auth_tokens` (token_hash PK, account_id/email_hash, purpose, expires_at, used_at, created_at) — patrón hash-only idéntico a sessions.
- `webauthn_credentials` (credential_id_hash PK, account_id FK RESTRICT, public_key, sign_count, device_label, transports, created_at, last_used_at, revoked_at).
- `webauthn_challenges` (challenge_hash, account_id nullable, expires_at, single-use).
- Estas tablas se crearán con migration nueva en su fase; **04.2 no modifica migrations ni el schema FROZEN**. No hay incompatibilidad crítica detectada con el schema actual: `accounts` (sin password_hash) y `sessions` (token_hash) son exactamente lo que esta arquitectura requiere.

---

## §32. ACCEPTANCE CRITERIA — CHECKLIST

- [x] Estrategia primaria definida (passkey) — §25
- [x] Estrategia de recovery (magic link) — §12
- [x] Passkeys evaluadas — §3
- [x] Magic Link evaluado — §4
- [x] Email OTP evaluado (rechazado) — §5
- [x] OAuth evaluado (opcional futuro) — §6
- [x] Account enumeration mitigada — §8
- [x] Token security definida — §9
- [x] Rate limiting definido — §10
- [x] Session boundary definida — §11
- [x] CSRF strategy definida — §20
- [x] Mobile UX definida — §22
- [x] Recovery threat model — §12/§13/§28
- [x] Admin/user separation — §16
- [x] ADR creado — §27 (ADR-012)

---

## §33. NO CODE

Cumplido: ningún cambio en `worker.js`, `app.js`, `index.html`, `admin.html`;
ningún endpoint; ninguna migration; ningún middleware.

**FINAL STATUS: AUTHENTICATION ARCHITECTURE FROZEN**
