# NEXO — Identity Architecture & Security Specification

**Fase:** 04.0 — Architecture / Security Design (specification only, no implementation)
**Autor:** Principal Architect specification
**Estado:** DOCUMENT — ningún código, migración o tabla se crea en esta fase

Documento complementado por `identity-architecture-adrs.md` (ADRs numerados, en la misma carpeta).

---

## TABLA DE CONTENIDO

1. Executive Summary
2. Current NEXO Context
3. Architectural Principles
4. Identity Model
5. Authentication Model
6. Session Model
7. Authorization Model
8. RBAC / ABAC Decision
9. Listing Ownership
10. Moderation Model
11. Audit Model
12. Privacy Model
13. Database Model
14. Cloudflare Architecture
15. PWA Security
16. Threat Model
17. OWASP Alignment
18. Abuse Prevention
19. Observability
20. Migration Strategy
21. Implementation Phases
22. Risks
23. Open Questions
24. Final Architectural Recommendation
25. Acceptance Criteria Checklist
26. Final Report

---

## 1. EXECUTIVE SUMMARY

NEXO pasa de plataforma pública de descubrimiento a marketplace inmobiliario moderado. Esta especificación define la arquitectura de identidad solo a nivel de diseño, lista para implementar por fases:

- **Identidad separada de perfil.** Minimización de datos: `accounts` = quién es, `profiles` = cómo se presenta.
- **Passwordless-first.** Magic link por email como método primario; password legacy opcional con Argon2id. Evita almacenar hashes robables para la mayoría de usuarios y elimina criptografía custom.
- **Sesiones opacas en cookies**, no JWT: identificador aleatorio de 256bit, lookup en D1, rotación, revocable. HttpOnly+Secure+SameSite=Lax.
- **Autorización híbrida**: RBAC para roles del sistema, ownership/state-based para recursos. `users.role` jamás decide solo.
- **Ownership como relación explícita** (`listing_owners`), no `properties.owner_name`. Actor legal/creator/agente separados.
- **Moderación como máquina de estados** con eventos inmutables (`moderation_events`), FK a `accounts` en transiciones. Un usuario jamás puede `published` directo.
- **Auditoría append-only** separada (`audit_events`), con `correlation_id` por request, jamás secretos ni tokens.
- **Privacidad por diseño**: clasificación explícita público/privado/seguridad/administrativo. Anonymous→Account con favoritos locales sincronizables.
- **Deletion = anonymize** con excepciones justificadas (audit de moderación), elegido en ADR-008.
- **Backward-compatible**: endpoints públicos existentes y admin por `ADMIN_TOKEN` siguen funcionando; el camino a cuentas no rompe URLs, SEO, PWA ni favoritos locales.
- **Todo sobre Cloudflare Workers + D1 + R2**, sin dependencias pesadas ni terceros de auth; decisiones documentadas en ADRs.

Estado final: **ARCHITECTURE READY** (ready for implementation, no production).

---

## 2. CURRENT NEXO CONTEXT

Contexto verificado contra el código y la base D1 remota (solo lectura):

- **Worker único same-origin** (`worker.js`) sirve API y estáticos (binding `ASSETS`, `run_worker_first = true`). Frontend estático en `public/`.
- **Rutas públicas**: `GET /api/health`, `GET /api/properties`, `GET /api/properties/:id`, `GET /api/properties/:id/similar`, `GET /api/config`, `GET /media/*` (R2), `POST /api/chat` (AI), `GET /property.html` con inyección SEO/JLSD escapada.
- **Rutas admin**: `/api/admin/verify`, `/api/admin/properties` GET/POST, `/api/admin/properties/:id` PUT/DELETE. Autenticación: header `Authorization: Bearer <ADMIN_TOKEN>` comparado en tiempo constante (fallback legacy `ADMIN_PASSWORD` a deprecar).
- **CORS restringido**: allowlist explícita = origen del propio deployment; solo `localhost` cuando el hostname es localhost. No hay `*`. `/api/admin//*` no admite CORS — decisión correcta que se mantiene.
- **Service Worker** (`public/sw.js`, `nexo-v3-stable`): cachea shell + imágenes + `GET /api/properties*` + `/api/config` con stale-while-revalidate. Excluye no-GET y `/api/admin/*`. Favoritos actualmente locales (client-side, probablemente localStorage).
- **D1 remota** contiene tablas heredadas de una iteración anterior: `users` (email, password_hash, name, role IN user/admin) y `favorites`/`user_favorites` (duplicadas). FKs INTEGER rotas contra `properties.id` TEXT. `schema.sql` solo define `properties`.
- **Security headers parciales**: `escHtml`/`escJson` en SEO interceptor; HSTS/CSP/etc. no configurados centralmente. Sentry opcional captura errores.
- **Problemas activos de infra**: bindings Pages Functions no resueltos (endpoints API en Pages devuelven 500); R2 deshabilitado en la cuenta (código 10042). La especificación Identity debe ser deployable con `wrangler deploy` al Worker, no depender de Pages Functions.

Scope de la evolución planificada como el prompt define: `ANONYMOUS → ACCOUNT → PROFILE → LISTINGS → MODERATION → PUBLISHED`.

---

## 3. ARCHITECTURAL PRINCIPLES

1. **Separación de conceptos**: IDENTITY (quién), AUTHENTICATION (prueba), AUTHORIZATION (permiso), PROFILE (presentación), OWNERSHIP (relación), MODERATION (estado), AUDIT (traza). Nunca un campo `users.role` decide toda la seguridad.
2. **Minimización de datos**: no guardar nada que no sea necesario para operar auth/recovery/reputación futura. Cada campo justifica su existencia.
3. **Sin criptografía custom**: usar únicamente primitivas estándar (Argon2id vía Workers, WebCrypto para tokens random).
4. **Fail-closed**: la negación es el default; los permisos solo se conceden de forma explícita
5. **Backward compatibility**: endpoints actuales y admin por Bearer siguen coexistiendo una transición.
6. **Cloudflare-native, no sobreingeniería**: Workers + D1 + R2. Nada que requiera servicios externos.
7. **Privacy by design**: la clasificación de datos precede al schema; jamás exponer privado sin autorización.
8. **Server-side first**: las decisiones de autorización y las validaciones en el Worker, el frontend solo presenta.
9. **Estados explícitos**: acciones mutables deben atravesar una máquina de estados autorizada con eventos.
10. **Seguridad medible**: cada threat model es objetivo tested con pruebas reales.

---

## 4. IDENTITY MODEL

### Actores conceptuales

| Actor | Propósito | Capacidades | Riesgos | Evolución |
|---|---|---|---|---|
| ANONYMOUS | Navegación pública | browse, search, favorites locales, contact | enumeration/abuse | fuente de funnel |
| USER | cuenta verificada o no | profile, favorites sync, crear listings DRAFT, inquiries | account takeover | base de reputación |
| OWNER | propietario de inmueble | sus listings, documentación, verificación | fake listings, legal contest | proofs, verificación propietaria |
| AGENT | operador de listings para otros | managed_by listings, maybe múltiples | phishing a owners, overposting | agency orgs futuras |
| AGENCY | entidad futura | member agents, collective listings | org compromise | post-MVP |
| MODERATOR | revisión de contenido/listings | UNDER_REVIEW → APPROVE/REJECT, reports | insider abuse | workload queues |
| ADMIN | plataforma y usuarios | user mgmt, publish power con audit | high privilege | least-privilege split |
| SUPERADMIN | excepcional control | roles críticos, infra overrides | irreversible damage | step-up, audit intensivo |

### Decisión OWNER vs USER

**Ownership no es un rol, es una relación de recurso.** Un OWNER permanece un USER con capacidad adicional derivada de la relación `listing_owners`. Esto evita presuponer estructura fija y evita mezcla de roles. OWNER se comporta como un `listing_owners.relationship = 'owner'`, cuya validez puede requerirse eventualmente en verificación. El prompt insiste en hacer explícita esta decisión: ADR-005 la documenta.

Roles (`user_roles.role`) solo para MODERATOR/ADMIN/SUPERADMIN e AGENCY membership futura.

### Entidad `accounts`

Campos (inmutable identifier, solo lo imprescindible):

- `id` — TEXT, ULID o `crypto.randomUUID()`; jamás secuencias INTEGER predecibles.
- `email` — identificador primario, UNIQUE, normalizado lowercase.
- `phone` — opcional nullable, exactamente uno nullable.
- `password_hash` — nullable; solo si se habilita password/legacy path (Argon2id).
- `email_verified_at` / `phone_verified_at` — nullable.
- `status` — `'active'|'suspended'|'deleted'`; anonymous browsing no requiere cuenta.
- `created_at`, `updated_at`, `last_login_at`.
- `security_stamp` — INTEGER/hash que se invalida en password change/all-session-revocation.
- `deletion_state` — `'active'|'pending'|'anonymized'` con `deleted_at`.

Jamás almacenar: género, documentos, geolocal fina, marketing flags, exploración de números de inmigración. La información de contacto pública del listing puede ser profile-level, no account.

### Separación identity vs profile

- **Identity/Account** — autenticación, recovery, seguridad: email/phone/hash, email_verified, security_stamp, sessions.
- **Profile** — presentación y contexto: display_name, avatar R2, bio, city, idioma preferido, visibilidad (opciones de contacto), `agent_verification` markers.

No asumir que todo debe almacenarse desde la primera versión: profile es una entidad distinta con campos añadibles backward-compat.

---

## 5. AUTHENTICATION MODEL

### Comparativa inicial

| Método | Seguridad | UX móvil | Cuba disponibilidad | Terceros | Recovery | Resistencia takeover | Complejidad | Veredicto |
|---|---|---|---|---|---|---|---|---|
| Email/password | media | buena | buena | ninguno | fuerte | media (stuffing) | media | opcional |
| Passwordless magic link | alta | excelente | alta | email infra | buena | alta | baja | **primario** |
| Phone verification SMS | media | buena | limitada SMS cubano | SMS provider | dificil | baja (SIM swap) | media | futura |
| OAuth social | media | excelente | depende provider | Google/etc | buena | alta | alta | futura |
| Passkeys/WebAuthn | máxima | buena | hardware limitado | ninguno | fuerte | máxima | alta | futura |
| Legacy password + Argon2 | segura si bien hecha | buena | buena | ninguno | fuerte | media | media | optional legacy path |

**Recomendación: Passwordless-first por magic link (email).** Password opcional legacy path si se prefiere. OAuth/passkeys/SMS se añaden como mejoras por fases. Justificación: UX mobile muy buena; ausencia de hash robable; elimina least-feature selection; utilizable cuando Email funcione; rate-limitable; recuperación sencilla incluso con email comprometido frente a stuffing de hashes.

**Nota**: el path de password opcional, si se habilita,, debe usar Argon2id con parámetros documentados, nunca bcrypt con salt propio, y jamás store plaintext. La decisión exacta está en ADR-001.

Password security (si se habilita): hashing Argon2id (Mem 19MiB, 2 iteraciones, parallelism 1 como baseline), salt por-password (Argon2id lo embebe), work factor sensible a latencia, breached-password consideration opcional (k-anonymity haveibeenpwned), reset/rotation con invalidación de sessions, rate-limit por account+IP, lockout progresivo, jamás criptografía propia.

---

## 6. SESSION MODEL

Flujo conceptual: `LOGIN → SESSION (opaque D1) → REQUEST (lookup+cache en isolate) → LOGOUT (revoca)`.

- **Identificador**: random 256bit (`crypto.getRandomValues`), base64url, jamás JWT (no necesario; revocación y rotación complican lo moderno sin beneficio). Documentado en ADR-002.
- **Cookie**: `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=nexo...` (sin `Domain` para host-only). `Max-Age` como límite absoluto, jamás refrescos ciegos.
- **Expiración**: idle timeout 7d, absolute 30d. Rotación a cada uso válido (issued new token, previous moved a grace period).
- **Revocación**: real en D1 (solo 1 lookup/sw); `security_stamp` cambio invalida todas.
- **Concurrent sessions**: limitado razonable (p.ej. 5), listado y cierre individual en settings.
- **Device/session management**: device label opcional, `user_agent` bounded, mapa de sesiones revocables.

Cachear la session en isolate con TTL corto (p.ej. ≤35s) si el volumen lo exige; la fuente de verdad siempre D1. Revocación invalida cache vía publicación in-worker flag o TTL suficientemente bajo.

---

## 7. AUTHORIZATION MODEL

Authorization decisions en tres niveles explícitos: **Application** (entrada), **Resource** (objeto), **Action** (operación).

- Ejemplo: USER modifica solo *sus* recursos (ownership match), no los de otro.
- MODERATOR revisa listings en estado, no admin de infra, no revoke GLOBAL.
- ADMIN administra usuarios/listings; rango definido por role assignado.
- SUPERADMIN acceso excepcional, step-up, registrado en audit con razón.
- Toda acción modular requiere: `permit(actor, action, resource, context)` con ownership/state/role evaluados en servidor. Permission denied debe auditarse.

Nota de rendimiento: en Workers, lookup de roles + ownership puede cachearse pocos segundos tras fetch, y la decisión se calcula en isolate tras D1 read.

---

## 8. RBAC / ABAC DECISION

**No do RBAC solo por sencillez**: se evalúa role + resource ownership + resource state + permiso explícito.
- `user_roles` concede roles temporales con `granted_by` y `revoked_at`; la revocación actualiza `security_stamp`.
- Resource ownership se consulta en `listing_owners`; state proviene de listing; acción es endpoint-specific.
- El resultado es ABAC ligero implementable en D1 con joins pequeños e indexes, sin motor de políticas externo.
- Decision auditada en ADR-004 con alternativas y consecuencias.

---

## 9. LISTING OWNERSHIP

Nunca `properties.owner_name`. Relación de identidad explícita con roles:

- `created_by` → accounts.id (siempre se asigna en el alta).
- `listing_owners` (listing_id, account_id, relationship, created_at) con relationship IN `owner|agent|managed_by`.
- `owner` = legal owner, verificable en futuras fases con documentación.
- `agent` = permitted operator bajo managed_by.
- `managed_by` = organization bajo una AGENCY en fase futura.
- `created_by` persiste trazabilidad original incluso si ownership transfiere, atributo separado del owner legal, para trazabilidad.
- El administrador de plataforma (ADMIN) puede actuar con audit de razón expresa — **differenziado de creator**.

Transferencia de ownership exige evento en moderation_log/audit y en test agregado para evitar abuso por robo de cuentas.

---

## 10. MODERATION MODEL

Máquina de estados conceptual de listings (eventos inmutables):

```
DRAFT → SUBMITTED (creator)
SUBMITTED → UNDER_REVIEW (moderator)
UNDER_REVIEW → APPROVED | REJECTED (moderator, reason mandatory)
APPROVED → PUBLISHED (system transition)
PUBLISHED → SUSPENDED (admin/moderator, reason)
PUBLISHED → ARCHIVED (creator o admin, voluntario o retirado)
* → ARCHIVED (soft-end)
```

- Quién puede cada transición se documenta en spec y se enforce con check de rol + state en el worker, jamás cliente.
- Cada transición produce una `moderation_events` row con actor, from/to, reason, timestamp, `request_correlation_id`.
- `status = published` nunca se establece directamente; solo por approved transition. API rechaza cambios directos — mitigación principal contra privilege abuse.
- Transiciones ilegales (perm actor/state mismatch) se logean como `PERMISSION_DENIED` audit event.

---

## 11. AUDIT MODEL

`audit_events` append-only conceptual:

- Eventos: LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_RESET_REQUEST/COMPLETE, EMAIL_VERIFIED, ROLE_GRANTED, ROLE_REVOKED, LISTING_CREATED, LISTING_SUBMITTED/APPROVED/REJECTED/PUBLISHED/SUSPENDED, ACCOUNT_DELETED, PERMISSION_DENIED.
- Campos: id (ULID), actor_id nullable, actor_type (user/anonymous/system), action, resource_type+id, timestamp, metadata JSON (no secretos, no tokens, no email crudo si innecesario), `correlation_id` por request, actor_ip/subset, actor_user_agent.
- El evento de login fallo **not include** token ni hash.
- `correlation_id` se propaga X-Request-Id en logs estructurados, tanto Worker → D1 como respuesta.

Retención conceptual: regulable; moderation/ownership eventos pueden tener retención distinta documentada en ADR-008.

---

## 12. PRIVACY MODEL

Clasificación explícita por campo; privacy by design.

| Clase | Ejemplos | Exposición |
|---|---|---|
| Public | title, precio, location aproximada, description, images, display_name, avatar URL | API pública, SEO, IA |
| Private relevant | phone exacto, email, address exacta hasta verificación, contact preferences, favorites | solo owner, admin con reason |
| Security | password_hash, security_stamp, session ids, attempts, verified flags | internal only, never API |
| Administrative | internal_notes, moderation reasons (pueden ser sensibles), audit metadata | admin/moderator con scope |

Reglas:
- El email privado, phone, notas internas y metadata de seguridad/moderación **jamás** en payload público, SEO o IA context.
- La IA se alimenta solo de campos classified- public; mapas de exposición se validan con tests.
- Profile solo expone a terceros lo explicitamente consentido (p.ej. contact preferences).

---

## 13. DATABASE MODEL

Entidades conceptuales (NO crear migraciones ni tablas):

| Entidad | PK | Relaciones | Índices | Campos sensibles | Lifecycle |
|---|---|---|---|---|---|
| accounts | ULID | profiles, sessions, user_roles, listing_owners | UNIQUE(email), idx(status) | email, phone, password_hash | → anonymized |
| profiles | account_id FK | accounts | display_name (opcional), idx(language) | bio? (public if set) | soft lifecycle |
| sessions | ULID | accounts | idx(account_id), idx(expires_at) | token_hash? opaque random | revoked/expired |
| roles (catálogo) | name PK | user_roles | — | — | prepopulated |
| user_roles | (account_id, role) composite | roles + accounts | idx(account_id) | granted_by | revoked_at |
| listings | ULID | properties* compatibility | idx(state), idx(created_by) | previous properties address/notes | DRAFT→ARCHIVED |
| listing_owners | (listing_id, account_id) | accounts+listings | idx(account_id), UNIQUE | relationship | revoked/transferes |
| moderation_events | ULID | listing+actor | idx(listing_id), idx(actor_id) | reason sensibles | inmutable |
| audit_events | ULID | actor nullable | idx(action), idx(correlation_id) | no secrets | append-only |

\* La migración de `properties` → `listings` se detalla en Migration Strategy; properties sigue existiendo. NO sobre-normalizar: catálogo `roles` como fila fija, composite PKs para evitar join innecesario. FKs con `ON DELETE` restringido; bcrypt mini fake off.

D1/SQLite considerations: foreign_keys=ON en batch; transactions `.batch()` para create account+profile+owned listing; unique constraints enforced de verdad (email, composite owners); concurrencia justificada — writes son serializadas en D1 leader; indexes de queries de permission y moderation timeline; evitar triggers complejos, prefer logic in worker.

---

## 14. CLOUDFLARE ARCHITECTURE

- **Secrets** via `wrangler secret put` (ADMIN_TOKEN futuro, PASSWORD_PEPPER opcional si legacy, TURNSTILE_SECRET opcional). Nunca vars públicas.
- **Env vars**: WHATSAPP_PHONE, SENTRY_DSN opcional, feature flags legacy-auth opcionales (nunca secretos).
- **API routes**: `/api/auth/*` con `Cache-Control: no-store` forzado en responses, y sesiones en Cookie; rutas `/api/admin/*` conservando no-CORS.
- **Cookies** firmadas conceptualmente por randomness (revocables), no JWT; `SameSite=Lax`, Secure. CSRF token sync-token por session.
- **Caching**: `env.ASSETS` y GET obran públicas; auth never cached. R2 media public only; no private attachments.
- **Service Worker**: passthrough para `/api/auth/*`, para mutables y para `/api/admin/*`, y jamás cachear responses con `Set-Cookie` o Authorization.
- **Compat**: Identity routes se añaden sin cambiar endpoints existentes ni SEO.

También aclaraciones: ACTUAL Pages deploy con bindings rotos debe resolverse desplegando el Worker (no depender de Pages Functions), antes de implementar fase 04.1.

---

## 15. PWA SECURITY

Authentication dentro de PWA móvil y offline:

- Todas las llamadas `/api/auth/*` y cualquier request que retorne `Set-Cookie/authorization/private` llevan `Cache-Control: no-store` y el SW las deja pasar (bypass explícito).
- Cache Storage solo alberga GET públicas; tokens/API/auth nunca en CACHE, jamás en IndexedDB/localStorage (cookies HttpOnly fuerzan eso).
- Logout limpia caches privadas si las hubiera (la spec manda que no existan) y revoca server-side.
- El modo offline puede exhibir favoritos locales y shell; las acciones autenticadas requieren red y muestran estado de error controlado.
- El SW excluye adicionalmente cualquier URL que empiece con `/api/admin/`, `/api/auth/` y rutas mutables (POST/PUT/PATCH/DELETE) — siendo explícitas por patrón.

Jamás polifill token reading en SW; la cookie va con mismo origin privacy-preserving.

---

## 16. THREAT MODEL

| Threat | Actor | Attack surface | Impact | Likelihood | Mitigation | Detection | Response |
|---|---|---|---|---|---|---|---|
| Credential stuffing | externo | /api/auth login | account takeover | alta | passwordless-first, rate-limit account+IP, lockout progresivo, Turnstile | LOGIN_FAILED spikes,分布式 IPs | block, notify, reset |
| Brute force | externo | auth/recovery | takeover/admin | media | timing-safe, exponential backoff, alertas por umbral | audit anomalies | suspend, rotate |
| Session theft via cookie | XSS/cache | session cookie | takeover | media | HttpOnly+Secure+SameSite, CSP estricto, cache exclusions, rotation | concurrent devices, anomaly | revoke all via security_stamp |
| CSRF | externo | mutaciones | state change no autorizada | media | SameSite=Lax + sync token por session, Origin/Referer check | denied attempts audit | reject+alert |
| Stored/reflected/DOM XSS | insider/ext | listing description, profile | session theft, defacement | alta | escapado server, CSP, no innerHTML sin sanitizer, image URL allowlist | CSP reports, audit | takedown, suspend, revoke |
| IDOR enumeration | usuario | /api/properties/:id privado | data leak | alta | ownership checks server-side, opaque IDs, authorization filter | 403 patterns | block |
| Privilege escalation | usuario | role fields admin | full control | baja | user.server-set roles only, separate role table, approval audit | ROLE_* audit | revoke+investigate |
| Account enumeration | externo | login/recovery | recon | media | respuestas uniformes, rate-limit recovery, no hints | spikes in recovery | challenge |
| Fake listings | usuario | listings create | fraud | alta | draft+review, verification opción, phone verif futura | REPORTED events | suspend account |
| Admin compromise | privileged | ADMIN_TOKEN/static | platform | media | rotate tokens, session-admin, step-up SUPERADMIN, IP signals | unusual admin actions | revoke+postmortem |
| Token leakage via URL/cache | interno | non-HttpOnly tokens | theft | media | cookies only, no tokens in URLs/JSON, cache no-store | logs audit | force logout |
| Cache leakage (PWA) | interno | SW cache privada | PII leak | media | SW passthrough auth, no-store | audits | SW update |
| API abuse / chat AI coste | externo | /api/chat, /api/search | coste | media | rate limit IP/session, quotas, Turnstile | quota metrics | throttle block |
| Scraping inventario | externo | GET públicas | SEO/competencia | alta | rate limit por IP, pagination | traffic patterns | rate resilient |
| SIM swap (SMS futuro) | externo | phone recovery | takeover | baja | not primary, fallback email, review | anomalies | suspend recovery |
| Email compromise | externo | magic link | takeover | media | short TTL tokens, consumed once, login notification, revoke sessions | unusual logins | revoke, reset |
| Session sync bug PWA | interno | offline state | incoherencia | baja | online-first auth ops, errors UI | telemetry | retry |
| Pages deployment binding bug | infra | Pages Functions | 500, auth fail | actual | deploy to Worker, test curl | health endpoint | rollback deploy |

## Decisiones threat-model

Mitigaciones se eligen por likelihood/impact para MVP: authentication rate-limit+audit primero, CSP/XSS/PWA caching después, verification y phone después.

---

## 17. OWASP ALIGNMENT

Relevancia específica para NEXO, no lista genérica:

- **Broken Access Control (Top10#1)**: ownership/state/role checks en Worker por recurso/acción; nunca del cliente. PROTECTED: listings DRAFT privados, /api/admin routes, profiles privados.
- **Identification & Authentication (Top10#7)**: passwordless-first, rate-limit, session revocation, breach consideration, failure uniform. ASVS 2.x controls se mapean en ADR-001/002.
- **Injection (Top10#3)**: únicamente prepared statements en D1 (`.bind`), validación server, art parameter binding en embeds; nueva profile input revalidado con whitelist.
- **XSS (ASVS 5.2)**: server-esc en SEO, CSP endurecida y JS externo con hash/nonce, image allowlist `${origin}/media/*`, no rich text HTML por defecto hasta policy explícita.
- **Security Logging & Monitoring (ASVS 7)**: audit_events + correlation_id + Sentry.
- **CSRF (ASVS 4.2)**: SameSite=Lax + token sync para la PWA native fetch.
- **Using Components with Known Vulnerabilities (Top10#6)**: zero runtime deps, Workers build-in Argon2, minimal surface.

ASVS verification examples MVP: 2.1 (password security si legacy), 2.2 (auth), 3.1 sesión segura cookies, 4.1 access control, 5.2 sanitizing/xss, 7.1 logging, 8.2 error handling sin leaks (INTERNAL_ERROR response ya usa opaque message).

---

## 18. ABUSE PREVENTION

Políticas conceptuales rate-limit diferenciadas:

- **IP rate limit**: `/api/auth/*` (login/magic/recovery), `/api/chat`, contacto, listing submit. Base: p.ej. 20 req/10min por IP en auth, ajustable en vars.
- **Account rate limit**: sesiones por cuenta, mágico-link resend, listing submit por account/24h, favorites ops.
- **Device/session signals**: user-agent y fingerprint opcional para detectar stuffing (audit solo, nunca bloqueo ciego).
- Anti-abuse decisions: responses uniformes para evitar user enumeration (mismo texto éxito/error en magic/recovery).
- Anti-bot conceptual: Turnstile (Cloudflare) opcional en signup/listing submit si spam real aparece — decisión ADR-010 futura.
- Sin complicar excesivamente: solo mechanisms that D1/Workers soportan (in-memory bucket por isolate + D1 counter opcional incremental).

---

## 19. OBSERVABILITY

Eventos estructurados (JSON) en Worker con `correlation_id`:

- Auth: LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, RECOVERY_REQUEST/COMPLETE.
- Session: SESSION_ROTATED, SESSION_REVOKED, SESSION_EXPIRED_ANOMALY.
- AuthZ: PERMISSION_DENIED con resource/action.
- Listing: LISTING_SUBMITTED/APPROVED/REJECTED, ABUSE_REPORT.
- Moderation: MODERATION_TRANSITION.
- Sentry solo errores reales, user context minimizado (id, no email).

Spec requiere: correlación X-Request-ID → audit, D1 evento opcional para anomalías, alert thresholds documentados en fases siguientes.

---

## 20. MIGRATION STRATEGY

Estrategia **backward compatibility**, no romper:

1. Properties actuales siguen funcionando como listings PUBLISHED legacy con `created_by` NULL-sysadmin mientras se atribuyen (legacy admin conversion).
2. URLs públicas, SEO, JSON-LD, `/api/properties`, chat IA, sitemap: remain unchanged; se agregan endpoints `/api/auth/*`, `/api/me/*` nuevos.
3. Favorites locales (client-side) se sincronizan opcionalmente después de signup/login: endpoint merge por `property_id` dedupe; el usuario confirma tras first auth. No requerido para identidad.
4. Admin actual (`ADMIN_TOKEN` Bearer) **sigue operativo durante la transición**, se documenta deprecación con fecha, y se migra a `accounts` con role ADMIN + sessions. Jamás auth entremezclada en misma ruta sin control explícito.
5. PWA/SW nuevas rutas no cacheables añadidas al conmutador antes del deploy, retrocompatible con v3.
6. Legacy tables `users`, `favorites`, `user_favorites`: quedan en D1, documentadas, NO se tocan en esta fase; en migración posterior se evalúan: favorites pueden arquearse, users heredada queda como cadáver y se elimina solo tras traslado verificado.
7. D1 foreign_keys activación y transactions aplicada en 04.1.

No implementación todavía: solo la strategy.

---

## 21. IMPLEMENTATION PHASES

Secuencia propuesta y justificada (puede revisarse en 04.0 antes de código):

| Fase | Contenido | Justificación |
|---|---|---|
| 04.0 | Architecture/spec (este doc) | elimina ambigüedad |
| 04.1 | Database foundation (accounts, profiles, sessions, user_roles, audit_events) + FK mode + `.batch()` | base transaccional |
| 04.2 | Authentication magic-link-first + password opcional + rate-limit | sólo tras schema, verify email |
| 04.3 | Sessions & Logout + rotation + revocation + device mgmt | después de auth funcionando |
| 04.4 | Authorization model + user_roles + permission middleware docs | protege recursos |
| 04.5 | Profiles & favorites sync + privacy field mapping | UX del usuario |
| 04.6 | User listings + ownership relation | requiere auth+profiles |
| 04.7 | Moderation model + events + state machine | solo con listings + ownership |
| 04.8 | Admin migration ADMIN_TOKEN → accounts | una vez sesiones estables |
| 04.9 | Verification/verification docs, abuse reporting futuro | reputación después de moderación |
| 05.x | Passkeys/WebAuthn, OAuth, agency orgs | post-MVP |

Cada fase termina con audit de performance/mobile/errors y tests reales (sin mocks innecesarios).

---

## 22. RISKS

- Legacy admin coexistencia: mantener duel path aumenta superficie — mitigado con fecha de deprecación y audit.
- Email delivery Cuba: magic link depende de proveedor de email; verificar entrega; fallback password path opcional.
- Pages deployment problema actual: bloquea cualquier implementación hasta resolver WR deployment.
- D1 concurrency en moderation_events: garantizar uniqueness idempotente y `.batch()` transacional.
- Service Worker complex quirks: cualquier oversight puede cachear privado — requiere review obligatorio en 04.3.
- Rate limiting en Workers: in-memory isolate no es distribuido; aceptable para MVP, documentado como risk y escalable con D1 counters/queue si needed.
- Owner verification legal: sin documentos reales es reclamo; no prometer verificación no entregada.
- Cuentas duplicadas si SMS/OAuth futuros: normalized email clave y merge strategy documentada antes.

## Encontradas contradicciones internas (resueltas)

- JWT vs opaque: elegido opaque por revocación y sencillez; ADR-002 lo justifica.
- OWNER como rol vs relación: resuelto como relación (ADR-005).
- Favorites legacy tables duplicadas: dejadas intactas, migration posterior documentada.
- Password path y passwordless: passwordless-first, password opcional explícitamente, se documenta por coherencia.
- Pages/Worker: identidad desplegable en Worker, no depende de Pages Functions rotas.

---

## 23. OPEN QUESTIONS

- Proveedor de email para magic links en Cuba (sendgrid/mailchannels/etc) y políticas de entrega.
- Turnstile opt-in ante spam real: sí/no según métricas post-MVP.
- ¿Age verification o auto documentación owner requerirá compliance legal cubano? (Propietarios en Cuba tiene particularidades legales)
- ¿Retención audit y privacy legal exacta? A finanzas: no GDPR completa pero minimización asumida.
- ¿Favorites sync debe exigir signup? (tendencialmente sí; no prioridad)
- ¿Phone verification vale la complejidad SMS? tendencialmente no MVP.
- ¿Páginas Pages binding arreglar un separa arquitectura? Decidir antes de 04.1 aun cuando architecture identity no dependa.

---

## 24. FINAL ARCHITECTURAL RECOMMENDATION

Arquitectura propuesta: **Passwordless-first magic link + opaque D1 session cookies + híbrido RBAC/ownership con máquina de estados de moderación + audit append-only + privacidad clasificada + compatibility settled + deployed en Workers**. Las decisiones han sido tomadas y documentadas en `identity-architecture-adrs.md`, y las pendientes organizadas en Open Questions.

No es production-ready; esto es **ready for implementation**. Las implementaciones faseáis deben verificar que:
- cada API mutable rechaza sin sesión/permiso;
- listings solo pueden published mediante transición/rol;
- audit de cada acción sensible lleva correlation id;
- privacy map valida que ningún payload público incluye clases privadas/seguridad.

---

## 25. ACCEPTANCE CRITERIA CHECKLIST

| # | Pregunta | Respuesta en spec | Sección |
|---|---|---|---|
| 1 | ¿Quién es un usuario? | accounts con id inmutable, separación identity/profile | §4 |
| 2 | ¿Cómo se autentica? | magic link passwordless-first, password opcional | §5 |
| 3 | ¿Cómo se mantiene sesión? | opaque random cookie + D1 lookup | §6 |
| 4 | ¿Cómo se revoca? | sessions.revoke, security_stamp, logout real | §6 |
| 5 | ¿Cómo se recupera cuenta? | magic/recovery uniforme, tokens TTL, sessions invalidate | §5, §6 |
| 6 | ¿Cómo se autorizan acciones? | permit(actor, action, resource, context) trinivel | §7 |
| 7 | ¿Cómo se determina ownership? | listing_owners relation, created_by | §9 |
| 8 | ¿Cómo se evita IDOR? | ownership server checks, opaque ids | §7, §16 |
| 9 | ¿Cómo se evita privilege escalation? | roles en user_roles, solo server, audit ROLE_* | §7, §8 |
| 10 | ¿Cómo se protegen listings? | state machine, moderation events | §10 |
| 11 | ¿Cómo funciona moderación? | actor+from/to+reason+timestamp inmutable | §10 |
| 12 | ¿Cómo se audita? | audit_events append-only, correlation_id | §11 |
| 13 | ¿Cómo se protege PWA? | SW passthrough auth/mutables, no privates en cache | §15 |
| 14 | ¿Cómo se protege D1? | prepared .bind, FKs, transactions .batch, unique | §13 |
| 15 | ¿Qué datos son públicos? | classificada explicit | §12 |
| 16 | ¿Qué datos son privados? | classificada explicit | §12 |
| 17 | ¿Qué ocurre al eliminar cuenta? | anonymize con excepciones audit | ADR-008, §12 |
| 18 | ¿Cómo se evita cachear privado? | no-store auth, SW bypass | §14, §15 |
| 19 | ¿Cómo se limita abuso? | IP+account limits, responses uniform | §18 |
| 20 | ¿Cómo escala? | sessions lookup cache corta, D1 optimized indexes, Workers native | §6, §13, §24 |

---

## 26. FINAL REPORT

- **SPECIFICATION STATUS: ARCHITECTURE READY**
- No se ha implementado ni modificado código. Solo documentación.
- Open questions identificadas no bloquean la arquitectura; requieren decisión de producto/proveedor antes de 04.1.
- La siguiente acción recomendada: resolver (a) despliegue Pages vs Worker y (b) proveedor de email, y luego comenzar 04.1 Database Foundation.
