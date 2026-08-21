# AUTHORIZATION RUNTIME (04.5)

Implementación runtime de la arquitectura congelada en
`AUTHORIZATION-ARCHITECTURE.md` (04.4) + ADR-014. RBAC + resource
ownership + explicit policy checks, con **deny-by-default** y
**fail-closed**. Contrato: `authorize(actor, action, resource) →
{ decision: 'ALLOW' | 'DENY', reason }` — explícito y auditable,
jamás `undefined`/truthy.

Módulo: `src/auth/authorization/`
(`roles` / `permissions` / `matrix` / `actor` / `resource` /
`ownership` / `authorize` / `serialize` / `audit` / `index`).

## Actor model

```
actor = { type, accountId, sessionId, roles, plane, rolesError }
```

- `anonymous`: sin sesión válida.
- `user`: sesión válida (04.3) + roles resueltos server-side desde
  `user_roles` (`revoked_at IS NULL`) **en cada request** (sin cache
  de decisiones; presupuesto 04.4 §20: 1 roles query + ≤1 ownership
  query + 1 resource row).
- `system`: solo construido por gates server-side del Worker
  (hoy: plano admin legado). **Una petición HTTP jamás puede
  declarar** type/roles/plane/accountId — body, query, headers y
  cookies se ignoran (tests: role/owner_id tampering).

El actor nunca contiene tokens de sesión, passwords ni secretos.
Error en el lookup de roles → `rolesError=true` → **todo DENY**
(fail-closed, no degrada a anónimo ni a allow).

## Role model

- PUBLIC / USER: implícitos (sin fila en DB).
- OWNER / AGENT: **relación** vigente en `listing_owners`
  (`revoked_at IS NULL`), no rol global. Rol global jamás sustituye
  relación.
- MODERATOR / ADMIN: roles core en `user_roles` (catálogo cerrado
  por CHECK en `roles`). Grants **explícitos** en `matrix.js`, sin
  herencia jerárquica (ADMIN lista sus capacidades de moderación
  explícitamente).
- SUPERADMIN: break-glass, 0 cuentas en producción, **0 grants
  operativos** en la matriz.
- AGENCY: FUTURE, sin grants.

## Permission model

Catálogo cerrado en `permissions.js` (`resource.action`). La matriz
rol→permiso es una **constante compilada** (`matrix.js`): añadir un
permiso exige editar catálogo + matriz + tests en el mismo diff.
No existe `property.publish` como permiso: publicar es efecto de
`moderation.approve` (workflow 04.8, no implementado aquí).

## Ownership model

`authorize()` resuelve la relación en `listing_owners` contra
`properties.id` INTEGER (04.4.1) **server-side en cada decisión**.
Cualquier campo del objeto `resource` que venga del exterior
(`relationship`, `owner_id`, `account_id` forjados) se **ignora** —
la relación solo sale de D1. Condiciones de estado (matriz §12):
`delete` exige owner ∧ status ∈ {draft, rejected}; `submit` exige
owner/agent ∧ status ∈ {draft, changes_requested}.

## Resource resolution & public_code

`classifyListingIdentifier()` decide la columna por patrón
(`N-\d+` → `public_code`, uppercase; resto → `id` interno), sin
CASTs. `resolveListing()` devuelve `{ id, public_code, status,
created_by }`. La decisión de autorización opera siempre contra el
**id interno**; `public_code` es solo el identificador de entrada.
Binds parametrizados en todo (inyección → simplemente no matchea).

## IDOR / BOLA / escalación

- Toda acción con scope de listing resuelve existencia + relación +
  estado antes de evaluar (BOLA: actor+action+resource).
- Horizontal: mismo rol, listing ajeno → DENY (`condition_not_met`).
- Vertical: `moderation.*`/`admin.*` solo vía grants de rol en
  `user_roles`; el cliente no puede inyectarlos.
- Recursos no autorizados: respuesta uniforme (`denyResponse`):
  401 sin autenticación, **404 indistinguible** para no-staff sobre
  listings (anti existence-oracle), 403 semántico para staff/planos
  sin scope de recurso.

## Field-level authorization

Serialización **whitelist por audiencia** (`serialize.js`), jamás
blacklist ni `delete` tras `SELECT *`:

| Audiencia | Campos |
|---|---|
| `public` | id, public_code, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at |
| `owner` (= owner/agent del listing) | public + address, owner_name, owner_phone, status |
| `moderator` | owner + internal_notes, created_by |
| `admin` | = moderator |

La audiencia se deriva del actor + relación server-side
(`propertyAudienceFor`). Endpoints públicos aplican **doble
barrera**: SELECT de columnas públicas + serializer `public` (y la
IA solo consume campos `public`). Campos de seguridad (stamps,
hashes, tokens) no existen en ninguna whitelist.

## Plano admin legado

`ADMIN_TOKEN` (Bearer, timing-safe) **autentica** el plano;
`authorize()` **decide** con actor `system` +
`plane='legacy_admin_bearer'` y lista cerrada enumerada
(`property.read_internal/create/update/delete`). Deuda documentada
(04.4 §7): migra a `user_roles.role='ADMIN'` + passkey en fase
posterior con ADR propio. Una sesión de usuario **jamás** autentica
`/api/admin/*` (testeado). Rol ADMIN (account-based) hoy no tiene
grants de edición de contenido: edita el plane legado, auditado.

## Error model

Decisión: `{ decision, reason }` con reason enumerable
(`invalid_actor`, `unknown_action`, `role_resolution_failed`,
`resource_required`, `resource_lookup_failed`,
`ownership_lookup_failed`, `resource_not_found`,
`resource_not_public`, `authentication_required`,
`condition_not_met`, `no_matching_policy`,
`system_action_not_enumerated`). HTTP: 401/403/404 según
`denyResponse` (arriba); los cuerpos nunca revelan ownership, roles
ni políticas.

## Audit model

`audit_events` append-only (04.0 #13). Eventos emitidos:
`authorization_sensitive_allowed` (mutaciones del plano admin tras
éxito, con `resourceId` real) y `authorization_denied` (decisiones
DENY en plano admin autenticado). Metadata saneada (se descartan
claves `token|secret|password|cookie|authorization`); jamás
secretos. Emisión **best-effort** fuera del critical path
(`ctx.waitUntil`): un fallo de escritura se loguea y no altera la
decisión ya tomada (fail-closed ocurre *antes* del audit).

## Logging

Solo `console.error` de fallos internos (audit write, vectorize);
nunca Authorization headers, cookies, tokens ni passwords.

## Rate limiting / CSRF

Sin sistemas nuevos: se reutiliza `enforceRateLimit` (04.3 lo
aplica a `/api/session/*` y `/api/chat`) y `isStateChangingAllowed`
(CSRF por Origin allowlist). Las rutas admin usan Bearer (sin
cookies) → sin superficie CSRF. Las operaciones USER state-changing
llegarán con 04.7 y usarán el mismo mecanismo.

## Alcance y límites (honestidad de fase)

- Endpoints USER de CRUD de listings (`property.create/update/
  delete/submit`) **no existen aún**: pertenecen a 04.7. El runtime
  (`authorize` + guards + serializers) ya implementa y testea su
  contrato de decisión.
- Workflow de moderación (estados submitted/under_review/…) → 04.8;
  las condiciones de estado ya contemplan esos valores.
- Moderation/role/account endpoints → fases posteriores; sus
  permisos ya están en catálogo + matriz + tests de contrato.
- Agency isolation / multi-tenancy: diseñado (04.4 §14), no
  implementado (sin tablas agency-scoped; no se inventan).
- Sin migrations, sin cambios en producción, sin cuentas ni roles
  insertados.
