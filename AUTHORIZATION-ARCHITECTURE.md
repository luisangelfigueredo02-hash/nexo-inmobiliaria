# NEXO — AUTHORIZATION ARCHITECTURE (04.4) — FROZEN

**STATUS: FROZEN — arquitectura pura. CERO código de runtime.**
Base: 04.0 (Identity), 04.1/04.1-FIX (Schema FROZEN), 04.2 (Authentication),
04.2.1 (Security Baseline), 04.3 (Session Runtime).

Esta fase responde una sola pregunta:

> **WHO CAN DO WHAT TO WHICH RESOURCE, UNDER WHICH CONDITION?**

Fronteras heredadas (no se mezclan):

| Capa | Pregunta | Fase |
|---|---|---|
| AUTHENTICATION | WHO ARE YOU? | 04.2 (contrato), implementación futura |
| SESSION | HOW DO WE MAINTAIN AUTHENTICATED STATE? | 04.3 (implementado) |
| AUTHORIZATION | WHAT ARE YOU ALLOWED TO DO? | **04.4 (esta spec) / 04.5 (runtime)** |
| RESOURCE OWNERSHIP | WHICH RESOURCE DO YOU CONTROL? | 04.4 (esta spec, vía `listing_owners`) |
| MODERATION | WHAT HAS NEXO ALLOWED TO BECOME PUBLIC? | 04.4 boundary / 04.8 runtime |

---

## §0. INSPECCIÓN — ESTADO REAL VERIFICADO (no asumido)

### §0.1 Schema FROZEN disponible para autorización (sin cambios)

| Tabla | Columnas relevantes | Uso en autorización |
|---|---|---|
| `accounts` | `id`, `status` ('active'/'suspended'/'deleted'), `security_stamp` | actor identity, estado de cuenta |
| `roles` | `name CHECK IN ('MODERATOR','ADMIN','SUPERADMIN','AGENCY')` | catálogo cerrado de roles globales |
| `user_roles` | `account_id`, `role`, `granted_by` (FK accounts, nullable), `granted_at`, `revoked_at`; PK(account_id, role, revoked_at); UNIQUE partial `idx_user_roles_current` (revoked_at IS NULL) | grants con historia grant→revoke→regrant |
| `listing_owners` | `listing_id INTEGER`, `account_id`, `relationship IN ('owner','agent','managed_by')`, `created_by`, `revoked_at`; PK(listing_id, account_id) | ownership/relación por listing |
| `properties` | `id`, `status` ('published'/'draft' actual), `created_by`, `owner_name`, `owner_phone`, `internal_notes`, `address`, … | recurso protegido principal |
| `moderation_events` | `listing_id`, `actor_id` (FK), `previous_state`, `new_state`, `reason`, `request_correlation_id`; INMUTABLE | audit de transiciones de workflow |
| `audit_events` | `actor_id`, `actor_type IN ('user','anonymous','system')`, `action`, `resource_type`, `resource_id`, `metadata` JSON, `correlation_id`, `actor_ip_subset`, `actor_user_agent` | audit append-only de autorización |
| `sessions` (04.3) | valida cookie → contexto | input de autorización |

### §0.2 Supuestos de autorización EXISTENTES en runtime (heredados)

1. **Plano público**: `GET /api/properties` ya filtra campos (whitelist de
   columnas públicas: excluye `address`, `owner_name`, `owner_phone`,
   `internal_notes`) y solo sirve `status='published'`. Field-level
   filtering ya existe de facto para el surface público.
2. **Plano admin legado**: `/api/admin/*` con Bearer `ADMIN_TOKEN` único
   (timing-safe). Sin roles, sin ownership, sin audit por actor, CRUD total
   de properties incluyendo fijar `status` directamente. Es deuda
   conocida: 04.2 §16 definió su migración a `user_roles.role='ADMIN'` +
   passkey obligatoria (fase posterior, con ADR propio).
3. **Session Runtime (04.3)**: entrega `{ authenticated, accountId,
   sessionId }`. No lee `user_roles` ni `listing_owners`. Frontera limpia.
4. **Contrato 04.2 §31**: 04.4 consume `account_id` autenticado y usa
   `user_roles` (current), `listing_owners`, `properties.created_by`.

### §0.3 Inconsistencia detectada (documentada, NO corregida en 04.4)

- ADR-009 declaró `properties.id INTEGER` canonical, pero la realidad de
  producción es `properties.id TEXT` formato `'N-001'` (schema.sql + worker
  generan `N-00X`). `listing_owners.listing_id` es `INTEGER` y
  `moderation_events.listing_id` es `TEXT`. **JOIN directo
  `properties.id = listing_owners.listing_id` es imposible hoy sin CAST.**
- Impacto en 04.4: el modelo de ownership es agnóstico al tipo; la
  corrección del tipo es una decisión de schema para la fase de
  implementación de Listings (04.7) o un 04.4.x-FIX posterior. Esta spec
  asume que la fase de implementación resolverá el tipo ANTES de escribir
  el primer JOIN de ownership. **Riesgo registrado: alto.**
- `properties.status` no tiene CHECK; hoy solo usa 'published'/'draft'.
  La máquina de estados completa (§9) requerirá migration futura (04.7/04.8).

---

## §1. PRIMARY AUTHORIZATION MODEL — DECISIÓN

> **RBAC + Resource Ownership (relaciones explícitas) + Explicit Policy
> Checks, evaluado en un único punto de decisión server-side.**

Confirma y formaliza ADR-003/ADR-004/ADR-005. NO es RBAC puro (no cubre
ownership), NO es ABAC/policy-engine (sobreingeniería en Workers+D1), NO es
ReBAC completo (no hay grafo general de relaciones; solo relaciones
explícitas listing↔account ya modeladas en `listing_owners`).

Contrato conceptual (§42 del prompt):

```
authorize(actor, action, resource) → ALLOW | DENY

actor    := { accountId, sessionId, authenticated }   ← 04.3 §43
           + roles resueltos server-side (user_roles current)
           + NUNCA datos de rol/permiso del cliente (§26)
action   := permission atómico "resource.action" (§4)
resource := { type, id, row cargada server-side, state actual }
result   := booleano explícito; deny-by-default; fail-closed
```

Orden de evaluación (cortocircuito en el primer DENY):

1. **Actor válido**: sesión autenticada y cuenta `active` (vía 04.3).
   Anónimo solo tiene permisos `*.read_public`.
2. **Permiso por rol**: ¿el conjunto de roles current del actor incluye
   `action`? (matriz §12). Sin regla explícita → DENY (§21).
3. **Condición de recurso**: ownership/relationship/tenant/state según la
   fila CONDITION de la matriz (§10, §11, §38).
4. **Resultado**: ALLOW o DENY explícito. Cualquier error de lookup
   (D1, roles, ownership) → **DENY** (fail-closed, §22).

**Por qué este modelo y no otro** (§3, §4, §46):
- *RBAC puro*: insuficiente — "USER + property.update" no distingue "mi
  listing" de "listing ajeno" (IDOR por diseño). Rechazado.
- *ABAC/policy-as-code (OPA/Cedar)*: potente pero innecesario para ~30
  permisos y 4 tablas de decisión; añade motor, lenguaje y superficie de
  error en un entorno Cuba-constraint (3G, Workers, D1). Rechazado.
- *ReBAC (grafo tipo Zanzibar)*: las relaciones de NEXO son pocas y
  explícitas (owner/agent/managed_by; membership de agencia futura). Un
  grafo general es sobreingeniería hoy; las relaciones concretas caben en
  `listing_owners` + una futura tabla de membership. Rechazado para MVP.
- *Híbrido elegido*: roles globales pocos (catálogo cerrado en DB),
  ownership/relación por recurso, condiciones explícitas por acción.
  Simple, auditable (un punto de decisión), performante (≤3 lookups
  indexados por request), extensible (añadir permiso = fila en matriz +
  test), seguro (deny-by-default, fail-closed).

---

## §2. ROLE MODEL (§5, §6, §7)

### §2.1 Clasificación

| Rol | Clase | MVP? | Fuente de verdad |
|---|---|---|---|
| PUBLIC (anónimo) | implícito | sí | ausencia de sesión |
| USER (autenticado base) | implícito | sí | sesión válida, **sin fila en user_roles** |
| OWNER | **relación, no rol** | sí | `listing_owners.relationship='owner'` |
| AGENT | **relación, no rol** | sí | `listing_owners.relationship='agent'` |
| MODERATOR | CORE role | sí | `user_roles.role='MODERATOR'` |
| ADMIN | CORE role | sí | `user_roles.role='ADMIN'` |
| AGENCY | FUTURE role (catálogo ya existe) | no | `user_roles.role='AGENCY'` + membership (tabla futura) |
| SUPERADMIN | SYSTEM role, break-glass | catálogo solamente | `user_roles.role='SUPERADMIN'` — **0 cuentas en producción** |
| SYSTEM | actor sintético | sí | `audit_events.actor_type='system'`, **sin account_id** |

Decisión clave (heredada de ADR-005, confirmada): **ownership NO es rol
global**. OWNER/AGENT son relaciones por listing. Un usuario no "es" owner;
es owner *del listing X*. Esto elimina la sobrecarga de roles y modela la
realidad inmobiliaria cubana (particular con N propiedades, agente que
gestiona listings ajenos).

### §2.2 Definición formal por rol (§5)

**PUBLIC (anónimo)**
- Purpose: browsing SEO/marketplace sin fricción (Cuba: cuenta no debe ser
  requisito para buscar vivienda).
- Capabilities: `property.read_public`, `property.search`, `config.read`.
- Restrictions: ningún dato privado; ninguna mutación; rate limit IP.
- Security sensitivity: baja (superficie pública ya filtrada por whitelist).
- Lifecycle: n/a. Assignment: n/a.

**USER (autenticado baseline)**
- Purpose: identidad mínima para publicar/gestionar lo propio y contactar.
- Capabilities: `property.create`, `property.update` (si owner/agent del
  recurso), `property.submit`, `property.delete_own` (si owner y estado
  draft/rejected), `profile.read_self`, `profile.update_self`,
  `session.manage_self`.
- Restrictions: jamás `property.publish`, jamás moderation.*, jamás datos
  de terceros, jamás admin.*.
- Security sensitivity: media (es el rol más poblado; cualquier bypass
  horizontal es daño masivo).
- Lifecycle: nace con la cuenta; muere con suspension/deletion
  (`accounts.status` ya lo enforcea 04.3).
- Assignment: implícito al autenticarse. Revoke: suspension de cuenta.

**OWNER (relación)**
- Purpose: control total del listing propio dentro del workflow.
- Capabilities (condicionadas a `listing_owners` row vigente con
  relationship='owner'): `property.read_private` (todos sus campos
  owner-visible), `property.update`, `property.submit`,
  `property.archive_own`, `property.transfer_initiate` (futuro).
- Restrictions: no `property.publish` (moderación), no editar tras
  `published` salvo campos permitidos que re-encolan a revisión (§9), no
  ver datos de otros owners.
- Security sensitivity: alta (IDOR/BOLA target principal).
- Lifecycle: grant al crear listing (creator ⇒ owner row, created_by
  inmutable) o por transferencia auditada; revoke por transferencia o
  moderación (`revoked_at`).
- Assigned by: el sistema al crear; ADMIN/SYSTEM en transferencia
  auditada. Nunca auto-asignable a listings ajenos.

**AGENT (relación)**
- Purpose: agente que gestiona listings de un particular (o, futuro, de
  una agencia) sin ser dueño.
- Capabilities (condicionadas a relationship='agent' vigente):
  `property.read_private`, `property.update`, `property.submit`.
- Restrictions: NO `property.delete`, NO `property.transfer`, NO cambiar
  ownership, NO `property.publish`.
- Security sensitivity: alta (confunde fácil con owner; debe ser
  explícitamente menor).
- Lifecycle: grant por el OWNER del listing (o ADMIN); revoke por OWNER o
  ADMIN. Auditable vía `created_by` + `revoked_at` en listing_owners.

**MODERATOR (CORE role)**
- Purpose: proteger al marketplace de fraude/abuso antes de publicación.
- Capabilities: `moderation.review`, `moderation.approve`,
  `moderation.reject`, `moderation.request_changes`,
  `moderation.suspend_listing`, `property.read_internal` (campos
  necesarios para decidir: address, owner contact, internal flags),
  `audit.read_own_actions`.
- Restrictions: NO edita contenido del listing (decide, no redacta), NO
  `user.suspend`, NO `role.grant`, NO config, NO acceso a cuentas fuera
  del contexto de un caso de moderación, NO `audit.read_all`.
- Security sensitivity: alta (moderator abuse = publicación de fraude).
  Toda acción genera `moderation_events` + `audit_events`.
- Lifecycle: grant por ADMIN; revoke por ADMIN. Grant/revoke ⇒
  `security_stamp` rotation + revocación de sesiones del afectado (§19).
- Prohibido: usar ADMIN como shortcut de MODERATOR (§15 del prompt).

**ADMIN (CORE role)**
- Purpose: operación de la plataforma (cuentas, roles de staff,
  configuración, escalación de moderación).
- Capabilities: todo lo de MODERATOR (grant explícito en matriz, no por
  herencia transitiva) + `user.read`, `user.suspend`,
  `role.grant_moderator`, `role.revoke_moderator`,
  `listing.unpublish`, `listing.feature` (futuro, con entitlement),
  `config.update`, `audit.read_all`.
- Restrictions: NO `role.grant_admin` (solo SUPERADMIN), NO
  `security_stamp.reset` arbitrario, NO export masivo de PII sin evento
  auditado. Admin actúa sobre recursos ajenos **siempre con reason
  auditada** (ADR-005).
- Security sensitivity: máxima operativa. Passkey obligatoria cuando
  migre a account-based (04.2 §16): admin nunca magic-link-only.
- Lifecycle: grant por SUPERADMIN; revoke por SUPERADMIN. Revoke ⇒
  invalidación inmediata de sesiones (stamp + revokeAllSessions 04.3).

**AGENCY (FUTURE role — catálogo existe, no se usa en MVP)**
- Purpose (futuro): cuenta organización con N agentes (multi-tenancy §38).
- Modelo: role AGENCY en la cuenta-organización + tabla futura de
  membership (`agency_members`, NO creada ahora) que vincula accounts de
  agentes a la agencia; listings de la agencia vía
  `listing_owners.relationship='managed_by'` (hook ya presente).
- Restrictions: tenant isolation estricta — rol idéntico en Agencia A no
  abre recursos de Agencia B (§38).
- Assignment: ADMIN (alta de agencia verificada). Revoke: ADMIN.
- NO se implementa en 04.5; la matriz lo marca FUTURE.

**SUPERADMIN (SYSTEM role — catálogo solamente)**
- Purpose (§16): break-glass y gestión del propio staff. NO operación
  diaria.
- Capabilities: `role.grant_admin`, `role.revoke_admin`,
  `role.grant_superadmin`, `account.security_stamp.reset`,
  `emergency.suspend` (cualquier cuenta/listing).
- Restrictions: **0 cuentas en producción en MVP**; uso exige elevación
  explícita time-bound (grant temporal), audit completo y revocación al
  cerrar el incidente (§31, §32). Jamás para moderar contenido ni operar
  listings: para eso existe MODERATOR/ADMIN.
- Lifecycle: grant por otro SUPERADMIN o bootstrap documentado fuera de
  banda; revoke inmediato post-incidente. Todo grant/revoke ⇒ audit +
  invalidación de sesiones del afectado.

**SYSTEM (actor sintético, §17)**
- Purpose: procesos automáticos (sweeps de expiración, auto-archive,
  cleanup de sesiones, futuros crons de moderación).
- Modelo: `actor_type='system'`, `actor_id=NULL` en audit_events y
  moderation_events. **Jamás se falsifica un account_id** para el sistema.
- Capabilities: conjunto cerrado de constantes de política
  (`system.expire_listing`, `system.archive`, `system.cleanup_sessions`).
  System NO pasa por authorize() de usuario; sus acciones están
  hard-coded por proceso y auditadas igual.
- Security sensitivity: máxima (sin humano detrás) → cada proceso system
  lista explícitamente qué acciones puede emitir.

### §2.3 Jerarquía (§6)

**NO hay herencia jerárquica.** SUPERADMIN ⊃ ADMIN ⊃ MODERATOR con
privilegios transitivos implícitos está **prohibido**: cada fila de la
matriz (§12) es un grant explícito rol→permiso. Que ADMIN pueda
`moderation.approve` es porque la matriz lo lista explícitamente, no
porque "ADMIN > MODERATOR". Esto elimina privilege inheritance accidental
y hace la matriz la fuente única de verdad auditable.

### §2.4 Least privilege (§7)

- Nadie recibe un permiso que no necesita para su función.
- `ADMIN` jamás como shortcut: si un endpoint "solo funciona con admin",
  el problema es del modelo de permisos, no del endpoint — se define el
  permiso fino y se asigna al rol correcto.
- El catálogo `roles` es cerrado por CHECK constraint: añadir un rol
  exige migration (fricción deliberada).

---

## §3. PERMISSION MODEL (§8)

Permisos **atómicos** con formato `resource.action`. No hay tabla de
permisos: el mapa rol→permiso es una constante de política compilada
(fuente única: matriz §12), lo que lo hace reviewable en diff y testeable
al 100%. Las **condiciones** (owner/agent/tenant/state) se evalúan contra
datos server-side en el momento de la decisión.

Catálogo MVP (frozen):

```
# properties / listings
property.read_public        # anónimo+: campos públicos de listings published
property.read_private       # owner/agent/staff: campos owner-visible
property.read_internal      # moderator/admin: campos internos p/ decidir
property.create             # user+: crea en estado draft (NUNCA published)
property.update             # owner/agent; si published → re-queue a revisión
property.delete             # owner && state IN (draft, rejected)
property.submit             # owner/agent: draft/changes_requested → submitted
property.archive            # owner sobre lo propio; admin sobre cualquiera
property.transfer           # owner inicia; admin ejecuta (futuro; auditado)

# moderación (transiciones de estado público — §14)
moderation.review           # tomar caso de la cola
moderation.approve          # submitted/under_review → approved → published
moderation.reject           # → rejected (reason obligatoria)
moderation.request_changes  # → changes_requested
moderation.suspend_listing  # published → suspended (fraude detectado)

# cuentas y perfiles
profile.read_self / profile.update_self
user.read                   # admin: datos de cuenta para soporte
user.suspend                # admin: accounts.status → suspended

# roles (sensible — §18)
role.grant_moderator / role.revoke_moderator     # admin
role.grant_admin / role.revoke_admin             # superadmin
role.grant_agency (FUTURE)                       # admin

# plataforma
config.read / config.update
audit.read_own_actions      # moderator: su propio rastro
audit.read_all              # admin
media.upload                # autenticado, cuota; ligado a listing propio o draft
```

Permisos FUTURE documentados (no en matriz MVP): `entitlement.*`,
`agency.*`, `message.*`, `favorite.*`, `billing.*`.

---

## §4. RESOURCE TYPES (§9)

| Recurso | MVP | PK/identidad | Notas |
|---|---|---|---|
| `property` (= listing) | ✅ | properties.id (TEXT 'N-001' hoy; inconsistencia §0.3) | recurso central |
| `account` | ✅ | accounts.id | staff-only read |
| `profile` | ✅ | profiles.account_id | self-service |
| `media` | ✅ | R2 object key | subida ligada a listing propio/draft |
| `moderation_case` | ✅ (conceptual; = listing en cola) | listing_id | no tabla nueva: cola = query por status |
| `moderation_event` | ✅ (read staff) | ULID | inmutable |
| `audit_event` | ✅ (read staff) | ULID | append-only |
| `session` | ✅ (self) | sessions.id | 04.3 |
| `agency` | FUTURE | account con role AGENCY | §11 |
| `agent` (membership) | FUTURE | agency_members | §11 |
| `favorite`, `message`, `system_configuration`, `entitlement` | FUTURE | — | §40/§41 |

---

## §5. OWNERSHIP MODEL (§10, §11, §12)

Fuente de verdad: **`listing_owners`** (relaciones) + **`properties.created_by`** (provenance inmutable).

```
account ──< listing_owners >── property
              relationship: owner | agent | managed_by
              vigente si revoked_at IS NULL
properties.created_by = account creador (inmutable, audit/provenance)
```

Reglas frozen:
1. `property.update` exige relationship vigente `owner` **o** `agent` para
   ESE listing. Rol global nunca sustituye relación (un MODERATOR no edita
   contenido; un ADMIN edita solo con reason auditada).
2. `property.delete` exige relationship `owner` (agent NO borra).
3. Un listing puede tener 1 owner vigente y N agents vigentes
   (la unicidad de owner vigente la enforcea la lógica de 04.7; el schema
   admite la restricción vía lógica + test — PK es (listing, account)).
4. Transferencia: revoca row owner actual (`revoked_at`) + crea row nuevo
   owner + `audit_events.ownership_changed` + `moderation_events` si aplica.
   `created_by` jamás cambia (trazabilidad anti-robo de cuenta).
5. **Agencia (§11, FUTURE)**: `managed_by` = listing gestionado por una
   cuenta-agencia; la membresía agente↔agencia vivirá en `agency_members`
   (tabla futura documentada, no creada). Jerarquía de relaciones
   soportada por diseño: `account → agency (membership) → agent →
   listing (managed_by)` y en paralelo `account → listing (owner/agent)`.
6. Nunca confiar `owner_id`/`account_id` enviados por el cliente (§26):
   ownership se resuelve con `accountId` de sesión (04.3) contra
   `listing_owners`.

---

## §6. PUBLICATION & MODERATION BOUNDARY (§13, §14, §29, §30)

### §6.1 Workflow de estados del listing (target; hoy solo published/draft)

```
draft ──submit──> submitted ──review──> under_review
  ▲                  │                     │  ├─ approve ──> approved ──> published
  │                  │                     │  ├─ request_changes ──> changes_requested ──submit──> submitted
  │                  │                     │  └─ reject ──> rejected
  │                  │                     └─ reject ──> rejected
published ──suspend──> suspended ──(review)──> published | rejected
published|suspended|rejected ──archive──> archived
```

- **Workflow ≠ authorization** (§29): el estado describe *dónde está* el
  listing en el pipeline; la autorización decide *quién puede ejecutar la
  transición*. `status` jamás es un permiso.
- **Toda transición** escribe `moderation_events` (inmutable) con actor,
  from/to, reason, correlation_id. Transiciones automáticas usan
  `actor_type='system'`.
- **`published` jamás se fija directamente** (04.0 §10): solo vía
  `moderation.approve`. La API rechaza updates que toquen `status` fuera
  de la máquina de estados.

### §6.2 Separación create/edit vs publish (§13, §14)

| Acción | Actor | Permiso |
|---|---|---|
| create (draft) | USER | `property.create` |
| edit draft | OWNER/AGENT | `property.update` + relación |
| submit | OWNER/AGENT | `property.submit` + relación |
| review/approve/reject/request_changes | MODERATOR (y ADMIN explícito) | `moderation.*` |
| publish | **nadie directamente**: efecto de approve | `moderation.approve` |
| suspend listing | MODERATOR/ADMIN | `moderation.suspend_listing` |
| unpublish/archive ajeno | ADMIN (reason auditada) | `listing.unpublish` / `property.archive` |

La aprobación es una **acción explícita de NEXO**, no un efecto lateral
del usuario (§14). USER ACTION ≠ NEXO MODERATION DECISION.

### §6.3 Visibilidad por estado (§29)

| Estado | Público | Owner/Agent | Moderator/Admin |
|---|---|---|---|
| draft | invisible (404) | completo | lista+lee (soporte) |
| submitted / under_review / changes_requested | invisible (404) | completo | cola + campos internos |
| approved / published | campos públicos | completo | completo |
| rejected / suspended | invisible (404) | completo + reason visible al owner | completo |
| archived | invisible (404) | completo (read-only) | completo |

Recursos no autorizados responden **404 indistinguible** para no-staff
(anti existence-oracle); staff autorizado recibe 200/403 semántico.

---

## §7. ADMIN MODEL (§15, §44)

- **Dos planos, frontera dura**: plano público (sesiones 04.3 +
  autorización 04.5) y plano admin. `ADMIN_TOKEN` (Bearer legado) **nunca
  se convierte en rol de usuario** (§44); una sesión de usuario jamás
  autentica `/api/admin/*` (ya enforceado y testeado en 04.3).
- **Migración documentada** (04.2 §16): el plano admin migra a
  account-based `user_roles.role='ADMIN'` + passkey obligatoria con ADR
  propio en su fase. Hasta entonces el Bearer legado opera y sus acciones
  auditan con `actor_type='system'` + `metadata.admin_plane='legacy_bearer'`
  (no existe account que poner en actor_id; no se falsifica).
- **ADMIN ≠ MODERATOR** (§15): MODERATOR decide sobre contenido; ADMIN
  opera la plataforma. La intersección (ADMIN puede moderar) es un grant
  explícito en la matriz, no una implicación jerárquica.

## §8. SUPERADMIN MODEL (§16)

Catálogo solamente; **0 cuentas en producción en MVP**. Break-glass (§32):
elevación explícita, time-bound (grant con caducidad operativa),
audit total, revocación obligatoria al cerrar incidente. No se implementa
elevación temporal en 04.5; se documenta como requisito de la fase que
introduzca el primer SUPERADMIN real.

## §9. SYSTEM ACTOR MODEL (§17)

`actor_type='system'`, `actor_id=NULL`. Procesos cerrados y enumerados
(expiry sweep, auto-archive, session cleanup). Cada proceso declara sus
acciones permitidas como constantes; cada acción audita igual que una
humana. **Prohibido** falsificar `account_id` para el sistema.

## §10. ENTITLEMENT MODEL (§40, §41)

**ROLE ≠ ENTITLEMENT.** Un entitlement es un grant comercial con ventana
de validez (featured listing, bump, agencia subscription, comisiones) —
concepto FUTURE, sin tabla ahora. Reglas frozen:
1. Entitlements **nunca** viven en `user_roles` ni en el catálogo `roles`.
2. Un entitlement puede *habilitar* una capability comercial
   (`listing.feature`), jamás *modificar* una decisión de autorización ni
   saltar moderación: **featured ≠ auto-publish**.
3. La decisión `authorize()` no consulta billing; el gate de entitlement
   es un check separado posterior a ALLOW (o previo como precondición de
   negocio), siempre auditado. Monetización jamás se convierte en rol.

## §11. DATA MODEL PUBLIC/PRIVATE + FIELD-LEVEL (§27, §28)

Serialización **whitelist por audiencia** (jamás blacklist):

| Recurso | PUBLIC | USER autenticado (no owner) | OWNER | AGENT (del listing) | MODERATOR | ADMIN | SYSTEM/internal |
|---|---|---|---|---|---|---|---|
| property: id,title,type,operation,price,province,city,neighborhood,bedrooms,bathrooms,area,description,images,lat/lng aprox,created_at | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| property: address exacta | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | internal |
| property: owner_name, owner_phone | ❌ | ❌ | ✅ (los suyos) | ✅ | ✅ | ✅ | internal |
| property: internal_notes | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | internal |
| property: status + moderation reason | ❌ | ❌ | ✅ (propio, incl. reason) | ✅ | ✅ | ✅ | internal |
| property: created_by / listing_owners | ❌ | ❌ | ✅ (propio) | parcial | ✅ | ✅ | internal |
| profile: display_name, avatar, bio, city, contact_preferences (opt-in) | ✅ | ✅ | self ✅ | — | ✅ | ✅ | — |
| account: email, phone | ❌ | ❌ | self ✅ | ❌ | solo en caso de moderación | ✅ | internal |
| account: status, security_stamp, sessions, stamps | ❌ | ❌ | ❌ (stamp nunca API) | ❌ | ❌ | status ✅ | internal |
| moderation_events / audit_events | ❌ | ❌ | ❌ | ❌ | moderation ✅ (listing scope); audit: propias | ✅ | internal |

Reglas: contacto público siempre vía relay (WhatsApp CTA) sin exponer
teléfono; email jamás en payload público/SEO/IA (04.0 §12); campos de
seguridad (stamps, sessions, hashes) **nunca** en API; la IA solo consume
campos PUBLIC.

## §12. PERMISSION MATRIX (§48) — FROZEN

Deny-by-default: ausencia de fila = DENY. OWNER/AGENT = relación vigente
en `listing_owners`. STAFF = MODERATOR o ADMIN.

| ROLE | RESOURCE | ACTION | ALLOW/DENY | CONDITION |
|---|---|---|---|---|
| PUBLIC | property | read_public | ALLOW | status='published' y campos whitelist públicos |
| PUBLIC | property | create/update/delete/submit/publish | DENY | — |
| PUBLIC | config | read | ALLOW | endpoint /api/config whitelist |
| USER | property | create | ALLOW | cuenta active; entra como draft; rate limit |
| USER | property | read_private | ALLOW | relationship owner/agent vigente en ESE listing |
| USER | property | update | ALLOW | relationship owner/agent; si published → re-queue |
| USER | property | delete | ALLOW | relationship owner AND status ∈ {draft, rejected} |
| USER | property | submit | ALLOW | relationship owner/agent AND status ∈ {draft, changes_requested} |
| USER | property | publish/approve/reject | DENY | moderación es decisión de NEXO |
| USER | property | archive | ALLOW | relationship owner |
| USER | profile | read_self / update_self | ALLOW | profile.account_id = actor.accountId |
| USER | media | upload | ALLOW | ligado a listing propio o draft propio; cuota |
| USER | account ajena | read/update/suspend | DENY | anti-escalación horizontal |
| USER | moderation.* | cualquiera | DENY | — |
| USER | role.* | cualquiera | DENY | jamás auto-asignación |
| AGENT (rel.) | property | update/submit | ALLOW | relationship='agent' vigente |
| AGENT (rel.) | property | delete/transfer | DENY | no es owner |
| MODERATOR | moderation | review/approve/reject/request_changes/suspend_listing | ALLOW | caso en cola (status elegible); reason obligatoria en reject/request_changes |
| MODERATOR | property | read_internal | ALLOW | campos internos para decidir |
| MODERATOR | property | update/create/delete | DENY | decide, no redacta |
| MODERATOR | account | read | ALLOW | solo en contexto de caso (listing relacionado) |
| MODERATOR | user.suspend / role.* / config.* | — | DENY | — |
| MODERATOR | audit | read_own_actions | ALLOW | actor_id = self |
| ADMIN | (todos los grants de MODERATOR) | — | ALLOW | grant explícito, no herencia |
| ADMIN | account | read / suspend | ALLOW | suspend ⇒ stamp rotation + revokeAllSessions |
| ADMIN | role | grant_moderator / revoke_moderator | ALLOW | audit + stamp rotation del afectado |
| ADMIN | role | grant_admin / grant_superadmin | DENY | solo SUPERADMIN |
| ADMIN | listing | unpublish / archive ajeno | ALLOW | reason auditada obligatoria |
| ADMIN | config | update | ALLOW | audit |
| ADMIN | audit | read_all | ALLOW | — |
| AGENCY (FUTURE) | agency-scoped resources | manage | ALLOW | tenant match agency_id = actor agency (§13) |
| SUPERADMIN | role | grant/revoke admin, grant superadmin | ALLOW | break-glass, time-bound, audit total |
| SUPERADMIN | account | security_stamp.reset | ALLOW | break-glass |
| SUPERADMIN | operación diaria (moderar, editar listings) | — | DENY | no es su función |
| SYSTEM | system.* | acciones cerradas por proceso | ALLOW | proceso enumerado; audit idéntico |

## §13. DATA ACCESS MATRIX (§49)

Ver §11 (matriz de campos por audiencia). Resumen de clases:
**public fields** → PUBLIC+; **user fields** → self/relación;
**owner fields** → OWNER/AGENT/STAFF; **internal/moderation fields** →
MODERATOR/ADMIN; **system fields** (stamps, hashes, sessions) → jamás API.

## §14. MULTI-TENANCY MODEL (§38, §39)

- MVP: single-tenant (plataforma NEXO, mercado Cuba) con tenancy
  **diseñada, no implementada**.
- Modelo futuro: agencia = tenant; toda tabla agency-scoped llevará
  `agency_id`; condición de autorización `tenant_match`:
  `resource.agency_id = actor.agency_id`. Rol idéntico en Agencia A jamás
  abre recursos de Agencia B (aislamiento aunque ambos sean "agent").
- Cuba market (§39): soporta particular (owner), agente independiente
  (relación agent), agencia (futuro AGENCY), moderadores y admins NEXO
  — sin privilegios artificiales: un agente independiente no necesita
  rol global alguno.

## §15. SECURITY MODEL — THREAT MODEL (§45) Y MITIGACIONES

| Amenaza | Mitigación frozen |
|---|---|
| **IDOR / BOLA** (§23) | Todo acceso a recurso por ID pasa por `authorize()`: existencia→404/403 uniforme para no-staff, relación `listing_owners` vigente + permiso + condición de estado. `/api/properties/123` editable solo si relationship vigente. |
| **Horizontal privilege escalation** (§24) | read/update/delete/publish de recursos ajenos → DENY por ausencia de relación; serialización whitelist por audiencia; tests de contrato A-vs-B obligatorios en 04.5. |
| **Vertical privilege escalation** (§25) | Roles solo desde `user_roles` server-side; body/query/cookies/headers jamás aportan rol/permiso/owner; grants solo por rol autorizado con audit + stamp rotation. |
| **Role tampering** | Catálogo cerrado CHECK; grant requiere `role.grant_*` del rol correcto; auto-grant estructuralmente imposible (actor no tiene el permiso). |
| **Permission tampering** | Permisos son constantes de política compiladas, no datos mutables por API. |
| **Ownership tampering** | Transferencia solo vía flujo auditado; `created_by` inmutable; `listing_owners` muta solo por paths autorizados. |
| **Tenant breakout** | Condición `tenant_match` en toda regla agency-scoped (futuro); tests de aislamiento A/B obligatorios. |
| **Field-level exposure** | Serializadores whitelist por audiencia; tests de snapshot por audiencia; PII jamás en público/SEO/IA. |
| **Moderator abuse** | Decide, no redacta; toda acción en `moderation_events` inmutable + audit; suspend/reject con reason obligatoria. |
| **Admin abuse** | Reason obligatoria en acciones sobre recursos ajenos; `audit.read_all`; admin no puede crear admins; migración a passkey obligatoria. |
| **Stale privilege / session privilege persistence** (§35) | Grant/revoke de rol ⇒ `security_stamp` rotation + `revokeAllSessions` (04.3) del afectado ⇒ ninguna sesión conserva privilegios revocados. Cache de permisos (si se introduce) keyed por (account_id, security_stamp), TTL ≤35s. |
| **Session fixation/rol heredado** | 04.3 rota sesión; 04.5 re-resuelve roles en cada request (o cache ≤35s con stamp). |
| **Existence oracle** | 404 indistinguible para recursos no autorizados (no-staff). |
| **Fail-open** | Cualquier excepción en la cadena de decisión ⇒ DENY (§22). |

## §16. DENY-BY-DEFAULT / FAIL-CLOSED (§20, §21, §22)

- `authorize()` devuelve **ALLOW solo con match explícito** de matriz +
  condiciones satisfechas. Ausencia de regla = DENY. Resultado booleano
  explícito, jamás truthy/falsy ambiguo.
- Fail-closed: error de D1, de lookup de roles/ownership/recurso o de
  evaluación ⇒ DENY + `audit_events.authorization_denied` con
  metadata.error_class (sin secretos). Ningún camino devuelve ALLOW ante
  fallo.

## §17. AUDIT MODEL (§33, §34)

Append-only en `audit_events` (y `moderation_events` para transiciones de
workflow). Cada evento responde: **WHO** (actor_id + actor_type), **WHAT**
(action), **RESOURCE** (resource_type + resource_id), **WHEN**
(created_at), **RESULT** (allow/deny en metadata), **WHY** (permiso que
matcheó o reason), más `correlation_id`, `actor_ip_subset`,
`actor_user_agent`. **Jamás** secretos, tokens, hashes, PII innecesaria.

Eventos mínimos (§34): `role_granted`, `role_revoked`,
`permission_changed` (cambio de política desplegado),
`authorization_denied`, `authorization_sensitive_allowed`,
`ownership_changed`, `listing_approved`, `listing_rejected`,
`listing_published`, `listing_suspended`. Transiciones de workflow van
además a `moderation_events`.

## §18. PRIVILEGE CHANGE & SESSIONS (§19, §35)

Role grant/revoke = operación sensible: (1) `user_roles` row
(granted_by obligatorio para grants staff), (2) `security_stamp`
rotation de la cuenta afectada, (3) `revokeAllSessions` vía 04.3
(privilege loss siempre; privilege gain recomendado), (4)
`audit_events.role_granted|role_revoked`, (5) notificación al afectado
(canal disponible, fase posterior), (6) re-autenticación obligatoria para
roles staff (passkey en el próximo login). No se implementa en 04.4.

## §19. TEMPORAL AUTHORIZATION & BREAK-GLASS (§31, §32)

- **Temporal**: grants time-bound (moderator elevado para incidente) se
  soportan con el modelo actual (`granted_at`/`revoked_at` ya existen;
  expiración operativa = revoke manual o sweep system). No se implementa;
  documentado como suficiente con el schema FROZEN.
- **Break-glass**: SUPERADMIN; explícito, auditado, time-bound, revocado
  post-incidente. No implementado; requisito para la fase que cree el
  primer SUPERADMIN.

## §20. PERFORMANCE & CACHE (§36, §37)

Presupuesto por request autorizado (04.5): 1 session lookup (04.3) + 1
roles query (`user_roles` indexado por account_id, filas ≤4) + ≤1
relationship query (PK listing_owners) + 1 resource row. **Sin N+1**:
endpoints de colección autorizan a nivel de query (owner list =
`WHERE listing_owners.account_id = ?`; cola de moderación =
`WHERE status IN (...)`), nunca autorizan fila a fila post-fetch.
Cache opcional: isolate-local keyed `(account_id, security_stamp)`,
TTL ≤35s (coherente con ADR-002/013); **jamás** cache global de
decisiones que mezcle usuarios; la clave siempre incluye el contexto del
actor (§37). Sin Redis ni infra nueva: Cloudflare-native (D1 + isolate).

## §21. AUTHORIZATION CONTEXT DESDE 04.3 (§43)

Input mínimo de Session Runtime: `{ authenticated, accountId, sessionId }`
+ resolución server-side de roles/relaciones en cada request (o cache
≤35s con stamp). **Jamás** se pasa el raw session token a la capa de
autorización ni a ningún consumidor.

## §22. IMPLEMENTATION BOUNDARY (§51)

| Fase | Pertenece |
|---|---|
| **04.5 Authorization Runtime** | `authorize()` + guards en endpoints, resolución de roles/relaciones, serializadores whitelist por audiencia, emisión de audit_events, tests de contrato IDOR/BOLA/matriz, migración del plano admin legado (con ADR propio) |
| **04.6 Profiles** | `profile.*` (read/update self), UX de perfil, contact_preferences opt-in |
| **04.7 Listings** | CRUD de property con ownership, `property.create/submit/update/delete`, resolución de la inconsistencia de tipos listing_id (§0.3, migration propia), ampliación de `properties.status` a la máquina de estados §6.1 |
| **04.8 Moderation** | cola, transiciones, escritura de `moderation_events`, permisos `moderation.*`, suspend/unpublish |

04.4 NO crea ninguno de estos.

## §23. TEST PLAN CONCEPTUAL (§50) — para 04.5

Cada caso = test de contrato automatizable contra `worker.fetch` (patrón
04.3) con D1 fake o local:

1. **anonymous access**: público lee published (200, campos whitelist);
   anónimo muta → 401/404; anónimo ve draft ajeno → 404.
2. **authenticated access**: USER crea draft propio (ALLOW); USER lee
   draft propio (200 completo).
3. **owner access**: update/submit/delete en estados permitidos → ALLOW.
4. **non-owner access**: USER B sobre listing de A → 404 (no-staff) en
   read_private/update/delete/submit/publish.
5. **agent access**: agent edita/sube (ALLOW); agent borra/transfiere
   (DENY).
6. **agency isolation (futuro)**: mismo rol, tenants A/B → 404 cruzado.
7. **moderator access**: approve/reject/request_changes/suspend desde
   estados elegibles (ALLOW + moderation_events row); editar contenido
   (DENY); user.suspend (DENY).
8. **admin access**: suspend account (ALLOW + stamp rotation +
   revokeAllSessions verificados); grant_admin (DENY); reason ausente en
   acción sobre ajeno (400/DENY).
9. **role tampering**: body `{role:'ADMIN'}`, query `?role=`, header
   `X-Role` → ignorados; decisión solo desde user_roles.
10. **owner_id tampering**: body `{owner_id: 'B'}` al crear/editar →
    ownership real = actor de sesión.
11. **IDOR**: `PUT /api/properties/{id}` autenticado sin relación → 404;
    id inexistente vs ajeno → respuestas indistinguibles (timing ≈).
12. **BOLA**: colección de "mis listings" no incluye ajenos; cola de
    moderación no filtra por actor salvo scope.
13. **field exposure**: snapshot de serializers por audiencia (público no
    recibe address/owner_phone/internal_notes/reason/stamps).
14. **deny by default**: permiso inexistente en matriz → DENY.
15. **fail closed**: D1 lookup lanza → DENY + audit, no 500 con ALLOW.
16. **stale session privilege**: rol revocado → stamp rotation → sesión
    previa con stamp viejo ya no autoriza (cadena 04.3+04.5).
17. **publish directo**: `PATCH status=published` por cualquier no-staff
    (y staff sin transición) → rechazado por máquina de estados.
18. **transfer audit**: transferencia crea events y created_by no cambia.

## §24. OPEN QUESTIONS (decisiones diferidas, no bloqueantes)

1. Tipo canonical de `listing_id` (TEXT 'N-001' real vs INTEGER de ADR-009)
   → resolver en 04.7 antes del primer JOIN de ownership (§0.3).
2. `agency_members` (tabla futura) y reglas de invitación a agencia.
3. Canal de notificación en privilege change (email ya necesario para
   magic link 04.2; reutilizar).
4. ¿Revisión periódica de grants staff (access review trimestral)?
   Recomendado: sí, proceso manual auditado al inicio.
