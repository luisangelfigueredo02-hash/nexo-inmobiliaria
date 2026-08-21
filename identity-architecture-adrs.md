# NEXO — Architecture Decision Records (Identity)

Fase 04.0. Documentación de especificación, sin implementación. Cada ADR: CONTEXT · DECISION · ALTERNATIVES · RATIONALE · CONSEQUENCES. Complementa `identity-architecture.md`.

---

## ADR-001 — Authentication strategy

**CONTEXT.** NEXO es mobile-first en Cuba, con conectividad 3G irregular y base inicial pequeña. No hay auth de usuarios hoy; solo `ADMIN_TOKEN`. El objetivo es maximizar seguridad y UX con mínima dependencia externa.

**DECISION.** Estrategia **passwordless-first**: magic link por email como método primario de creación de cuenta e inicio de sesión. Password queda como método legacy opcional (si se habilita, Argon2id obligatorio). OAuth/social, SMS y passkeys: fases posteriores, no MVP.

**ALTERNATIVES.**
1. Email/password como primario — rechazado: salta a hashes robables, stuffing, políticas de contraseña, y peor UX móvil.
2. SMS primario — rechazado: cobertura/coste SMS en Cuba, SIM-swap, dependencia de proveedor.
3. OAuth primario — rechazado para MVP: dependencia de terceros, fricción en Cuba, but keep door open por ADR futuro.
4. Passkeys primario — futuro: soporte desigual de dispositivos objetivo.

**RATIONALE.** Seguridad (no hay hash que robar para la mayoría), UX móvil excelente (un toque en el email), accesible en Cuba donde email funciona, coste operacional bajo (sin servicio de SMS ni IdP), simple de operar (tokens de un solo uso con TTL corto en D1).

**CONSEQUENCES.** Positivas: superficie mínima, sin breached-password handling en la mayoría de cuentas, recuperación unificada con el mismo mecanismo. Negativas: depende de entrega de email (open question de proveedor); usuarios que insisten en password requieren path legacy documentado con Argon2id; exige rate-limiting riguroso en el endpoint de envío.

---

## ADR-002 — Session strategy

**CONTEXT.** Necesitamos sesiones revocables, móvil-first, con PWA y Workers+D1. El equipo no debe operar infraestructura extra.

**DECISION.** **Sesiones opacas basadas en cookies + D1.** Identificador aleatorio de 256 bits (`crypto.getRandomValues`), cookie `HttpOnly; Secure; SameSite=Lax; Path=/` (host-only, sin `Domain`), lookup en tabla `sessions`, rotación en uso válido, idle timeout 7d y absolute 30d, revocación real en D1. **No JWT** para autenticación de usuarios.

**ALTERNATIVES.**
1. JWT stateless — rechazado: no mejor en nuestro contexto (revocación, rotación y sin sacrificio de estado requieren infra extra o expiraciones largas inseguras), añade firma/keys que jamás debemos customizar.
2. Tokens Bearer en JSON/localStorage — rechazado: robable por XSS, contradice HttpOnly.
3. Cookie con payload firmado (cookie-session) — rechazado: revocación imposible sin estado, datos expuestos.

**RATIONALE.** Prioriza lo más seguro y sencillo: un lookup rápido en D1 con índice; revocación inmediata y global vía `security_stamp`; sin criptografía propia; compatible con cookies y PWA; lazy isolate cache opcional solo reduce la lectura.

**CONSEQUENCES.** Una lectura por request auténtico (mitigada con cache de isolate TTL ≤35s si el volumen lo justifica); necesita índices en `sessions`; requiere reglas explícitas de SW para no cachear respuestas auth; logout y "cerrar todas las sesiones" son reales y auditables.

---

## ADR-003 — Authorization model

**CONTEXT.** Con usuarios, propietarios, moderadores y admins futuros, `users.role` como único mecanismo es insuficiente y peligroso. Las decisiones deben ser explícitas y auditables.

**DECISION.** Autorización en tres niveles — Application → Resource → Action — con una función lógica única `permit(actor, action, resource, context)` ejecutada en el Worker. El negar es default; nada de decisiones en cliente.

**ALTERNATIVES.**
1. Solo Role-based `users.role` — rechazado: mezcla identity y permisos, escala mal, no considera ownership ni estado.
2. Full policy engine externo (OPA/Cedar) — rechazado: sobreingeniería en Workers+D1 para MVP, dependencia extra.

**RATIONALE.** La forma explícita "who can do what to which resource under which condition" evita IDOR y privilege escalation por diseño; es implementable con joins pequeños e indexes en D1; se audita con PERMISSION_DENIED.

**CONSEQUENCES.** Todo endpoint mutable adopta el guard común; roles se leen de `user_roles`; ownership de `listing_owners`; state del listing. Confluye con ADR-004. Riesgo: inconsistencia si algún endpoint omite el guard — mitigado por test de contrato de autorización en spec/CI futuro.

---

## ADR-004 — RBAC vs ABAC

**CONTEXT.** RBAC solo no cubre ownership/state; ABAC puro en Workers+D1 es sobrecomplejo. El prompt exige no elegir RBAC solo por simplicidad.

**DECISION.** **Arquitectura híbrida**: RBAC para roles del sistema (MODERATOR/ADMIN/SUPERADMIN/memberships futuros) + autorización por resource ownership (`listing_owners`) + resource state (listing status) + permiso explícito por acción. Implementación ligera en D1, sin motor de políticas.

**ALTERNATIVES.**
1. RBAC puro — insuficiente: no representa "solo mi listing DRAFT".
2. ABAC/policy-as-code completo — innecesario y costoso en serverless Cuba; bloquea MVP.

**RATIONALE.** Captura los invariants: un usuario solo muta sus recursos, un moderador solo en su cola, un admin con razón auditada. La decisión se evalúa en servidor con datos cercanos (D1 same region).

**CONSEQUENCES.** Roles revocables (`granted_by`, `revoked_at`, sync `security_stamp`); ownership y state forman parte de cada check; la evolución a reglas más ricas no rompe los contratos. Complejidad controlada: un solo punto de decisión para testear.

---

## ADR-005 — Listing ownership

**CONTEXT.** Propiedades actuales tienen `owner_name`/`owner_phone` como texto libre (datos privados) que no establecen ownership. El prompt exige no asumir `owner_name` como mecanismo.

**DECISION.** Ownership como relación explícita: `created_by` (immutable account del creador) + tabla `listing_owners(listing_id, account_id, relationship)` con `relationship IN ('owner','agent','managed_by')`. El owner legal, el creador del anuncio, el agente gestor y el NEXO ADMIN son conceptos separados.

**ALTERNATIVES.**
1. OWNER como rol global de `user_roles` — rechazado: sobrecarga de roles, no representa relación concreta por listing.
2. `properties.owner_name` — rechazado: texto libre no verificable, fuga PII, ambiguo para permisos.

**RATIONALE.** La relación por listing permite ABAC ownership; `created_by` aporta trazabilidad incluso en transferencias; `relationship` modela agente gestor sin rol global. El listing creator queda distinguido del legal owner para verificación futura.

**CONSEQUENCES.** Transferencias de ownership quedan auditables; verificación del `relationship='owner'` es una fase posterior sin remodelar; ADMINs que actúan sobre listing de otro lo hacen con razón auditada y no se convierten en creator.

---

## ADR-006 — Account recovery

**CONTEXT.** Riesgo dominante: account takeover, email compromise, credential stuffing. En Cuba, SMS recovery es frágil (SIM swap/costo).

**DECISION.** Recovery = mismo magic link por email (path passwordless), tokens de un solo uso con TTL corto (p.ej. ≤15 min), y al usarlo se marcan `security_stamp` nuevo + revocación global de sesiones. Respuesta uniforme en/for recovery y login para no enumerar cuentas. Notificación opcional de login nuevo/dispositivo.

**ALTERNATIVES.**
1. SMS recovery — rechazado MVP: SIM swap/coste; evaluable más tarde como factor adicional, nunca único.
2. Security questions — rechazado: pocas pruebas reales, mala UX, riesgo de answers débiles.
3. Password reset clásico — solo si path password legacy habilitado (con invalidación de sesiones completa).

**RATIONALE.** Singular y simple: el mismo canal de magic link minimiza superficie; uniformidad evita enumeration; revocación total cierra el takeover tras recovery; notification ya visibiliza cambios.

**CONSEQUENCES.** Si el email está comprometido, el atacante puede solicitar recovery → mitigación: short TTL, token consumable, revocación global, y futura opción turnstile/anomaly. La dependencia de email es conocida; ver open question de proveedor.

---

## ADR-007 — Privacy/data separation

**CONTEXT.** Accounts mezclados con profiles exponen PII y complican minimización. La IA pública puede filtrar campos si no hay clasificación.

**DECISION.** **Separar explícitamente Identity (`accounts`) de Profile.** Accounts: email/phone/hash/sessions/security. Profile: display_name, avatar, bio, ciudad, idioma, preferencias de contacto (opt-in público). Clasificación por clases (public/private/security/administrative) y mapa de exposición validado por tests (jamás devuelve private/security en payload público, SEO o IA context).

**ALTERNATIVES.**
1. Una tabla `users` monolítica — rechazada: exposición accidental y rompe minimización.
2. Perfil dentro de accounts — rechazada: misma fuga por over-fetch.

**RATIONALE.** Minimización real: cada campo de profile se añade solo si el UX lo necesita; el público se controla; la IA toma solo public. D1 tolera bien la separación (joins pequeños).

**CONSEQUENCES.** Campos legacy `name` en profile (no en account) en migración futura; la visibilidad de preferencias de contacto siempre opt-in; audit no guarda secretos ni email crudo en metadata salvo cuando sea necesario.

---

## ADR-008 — Account deletion

**CONTEXT.** Eliminación completa colisiona con auditoría/integridad de moderación y ML state; retención total viola privacidad.

**DECISION.** **Soft delete + anonymization** tras período de gracia: alimentar `deletion_state=anonymized`, reemplazar email/phone por placeholder determinista, nulificar hash/detalle de seguridad, despublicar/archivar listings (manteniendo la relación con cuenta anónima), eliminar favorites e inquiries privados. **Audit de moderación/integridad se conserva** con actor anonimizado/ID oculto; logs necesarios aclarados.

**ALTERNATIVES.**
1. Hard delete absoluto — rechazado: destruye integridad de auditoría y moderation history.
2. Solo bloqueo/suspend — rechazado: no cumple derecho de borrado.
3. Retener todo por "legal" — rechazado: privacy-first no admite retención indiscriminada.

**RATIONALE.** Equilibrio: cumple privacidad de usuario y mantiene seguridad del marketplace (el historial de moderación ya está anonimizado). La excepción de conservación es explícita y mínima.

**CONSEQUENCES.** Listings se archivan; audit muestra actor id anonimizado; documentar la retención y pruebas de no exposición de data del eliminado; favorites/inquiries se eliminan realmente.

---

## ADR-009 — PWA authentication strategy

**CONTEXT.** PWA mobile-first con Service Worker cache; el riesgo es cachear privado. Favoritos locales hoy, auth futura.

**DECISION.** **Cookies HttpOnly + passthrough en SW**: el Service Worker excluye por patrón todas las rutas `/api/auth/*`, `/api/admin/*` y cualquier método no-GET de sus caches; respuestas autenticadas llevan `Cache-Control: no-store`. Cache Storage solo GET públicas. Tokens jamás en localStorage/IndexedDB/CACHE. Logout revoca en server y actualiza SW version si es necesario.

**ALTERNATIVES.**
1. JWT en localStorage — rechazado: robo por XSS y SW fetch con escalas de leak.
2. Interceptar auth en SW con logic — rechazado: complejidad, cache accident.

**RATIONALE.** Máximo seguridad simple: el SW es solo passthrough para auth/mutables, pasividad total para privado; PWA puede mostrar shell + favoritos locales offline pero operaciones autenticadas requieren red explícita con estado error.

**CONSEQUENCES.** Nuevas rutas deben añadirse a la bypass-list del SW; revisión de SW es requisito previo de implementación 04.3; favoritos locales se mantienen como primera clase y el sync se usa al autenticar.

---

## ADR-010 (opcional futuro) — Anti-abuse / Turnstile

**CONTEXT.** Spam de registros/listings puede surgir tras abrir cuentas.

**DECISION.** Rate limiting IP+account+device por fase. Cloudflare Turnstile queda **opcional** y no-bloqueante en MVP; evaluado con métricas reales.

**ALTERNATIVES.** CAPTCHA pesado — rechazado UX; nada de bloqueo ciego por fingerprint.

**RATIONALE.** Evitar sobreingeniería inicial; datos decidirán.

**CONSEQUENCES.** POST-listing/submit protected by account/IP quotas; enumeration mitigada por respuestas uniform.

---

## ADR-011 (añadido) — Why not JWT (explícita)

**CONTEXT.** El prompt exige "determinar si JWT es realmente necesario" y no asumir modernidad = mejor.

**DECISION.** No JWT para sesiones de usuario. Confirmado en ADR-002.

**ALTERNATIVES.** JWT — evaluado y rechazado allí por revocación/rotación/keys.

**RATIONALE.** Revocación real + sencillez.

**CONSEQUENCES.** Documentado explícitamente aquí para responder al prompt sección 6; nada adicional.

---

## ADR-009 — Listing Identifier Strategy (04.1-FIX)

**CONTEXT.** 04.1 commit 19532be introdujo listing_owners.listing_id TEXT
para coexistir con properties.id INTEGER, requiriendo CASTs permanentes en JOINs.
Esto viola la regla "NO utilizar casts como mecanismo normal de JOIN".

**DECISION.** **properties.id INTEGER (legacy) es canonical listing identifier.**
listing_owners.listing_id INTEGER, moderation_events.listing_id INTEGER.
No CASTs permanentes. Si una futura fase necesita ID público inmutable no
vinculado a DB PK, se crea `public_listing_id` TEXT separado (no INTEGER CAST).

**ALTERNATIVES.**
1. TEXT listing_id (status quo pre-fix) — rechazado: CASTs permanentes,
   inconsistencia tipos, JOIN fragility.
2. Migrar properties.id a TEXT — rechazado: migration destructiva, impacta
   properties table production (1 row real, URLs, indexes).
3. Introducir public_listing_id TEXT ahora — rechazado: añade complejidad
   sin uso inmediato; si se necesita, se añade en 04.2+ como columna nueva.

**RATIONALE.** properties.id INTEGER existe en producción, tiene índices,
es la PK autoincremental de la única property real. La consistencia INTEGER
elimina CASTs y mantiene type safety.

**CONSEQUENCES.** listing_owners.listing_id INTEGER FK-compatible;
moderation_events.listing_id INTEGER. Worker joins usan `properties.id =
listing_owners.listing_id` directo. Si en 04.2+ se requiere ID público no
vinculado a DB PK (ej: URL SEO inmutable), se crea columna separada TEXT.

---

## ADR-010 — Role Grant Actor Model (04.1-FIX)

**CONTEXT.** user_roles.granted_by carecía de FK. No añadir FK ciegamente
sin determinar si granted_by es siempre account o puede ser system/migration.

**DECISION.** **granted_by = TEXT REFERENCES accounts(id) NULLABLE.**
- NULL = system grant (bootstrap, migration, admin automation).
- NOT NULL = explicit account FK (actor humano que concedió el rol).

No string magic. No default value. No FK ciega a accounts solo si el actor
es siempre usuario; el sistema puede necesitar grants sin account.

**RATIONALE.** FK real para cuando granted_by es usuario (integridad
referencial). NULL para system grants (no forzar FK inválida). No
"migration"/"system" strings magic.

**CONSEQUENCES.** user_roles.granted_by TEXT REFERENCES accounts(id) ON DELETE
RESTRICT. Grants de sistema insertan granted_by = NULL. Grants de admin
insertan granted_by = admin_account_id. Lookup:
- System grants: WHERE granted_by IS NULL
- Account grants: WHERE granted_by = ?

---

## ADR-011 — Password Storage Decision (04.1-FIX)

**CONTEXT.** 04.1 introdujo accounts.password_hash TEXT nullable como
"legacy compatibility field". 04.0 ADR-001 establece passwordless-first
(magic link). No se implementa password auth en esta fase.

**DECISION.** **accounts.password_hash ELIMINADO (no reservado).**
No se mantiene para "compatibilidad futura". Si en fases posteriores se
requiere password auth explícitamente (legacy), se añade en migration
nueva con ADR específico, evaluando Argon2id y migración de datos.

**ALTERNATIVES.**
1. Mantener password_hash NULL — rechazado: introduce vía de autenticación
   no decidida, riesgo de uso prematuro, columnas huérfanas en schema.
2. Password auth ahora — fuera de scope; 04.0 define passwordless-first.
3. Passkeys/OAuth — fases posteriores per 04.0.

**RATIONALE.** 04.0 ADR-001: passwordless-first por magic link como método
primario. Password opcional legacy si se habilita (no MVP). Mantener
password_hash sin uso crea falsa expectativa de autenticación. Eliminar
ahora y añadir cuando se decida explícitamente evita scope creep.

**CONSEQUENCES.** accounts no tiene password_hash. 04.0 passwordless-first
queda en force. Si se decide password auth en futuro, nueva migration con
Argon2id + password reset flow + migration de datos.
