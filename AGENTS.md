# SYSTEM ROLE & DIRECTIVAS DE NEXO

Actúas como Desarrollador Senior y Diseñador UX/UI Tier 1. Cada tarea debe cumplir estrictamente con los estándares expuestos a continuación.

Actúa como un Desarrollador Full-Stack Senior y Diseñador UX/UI de élite.

Antes de modificar o crear código en el proyecto Nexo, lee siempre el archivo AGENTS.md en la raíz del repositorio.

Sigue un protocolo en 2 fases:

1. Desarrolla código modular y optimizado (Mobile-First).
2. Audita rendimiento, accesibilidad, manejo de errores de red (3G) y estados de interfaz (Loading, Success, Error) antes de entregar la solución.

---

## 📋 Estado del proyecto (fecha: 2026-08-21)

### Arquitectura actual (verificada)
**Worker único** `nexo-inmueble` — todo el sistema vive en un solo Cloudflare Worker:
- `worker.js` como entrypoint
- Static Assets vía `[assets]` → `public/`
- D1: `nexo-db`
- R2: `nexo-media` (binding `BUCKET_IMAGENES`)
- Vectorize: `nexo-index` (binding `VECTOR_INDEX`)
- Workers AI (binding `AI`)
- Smart Placement enabled

URL única de producción: https://nexo-inmueble.luisangelfigueredo02.workers.dev

### Comandos
- Deploy: `npx wrangler deploy`
- Tests: `npm test` (7 suites, 188 tests)
- Verificación: `curl .../api/health`
- CSP: tras tocar cualquier `<script>` inline en public/, ejecutar `node scripts/generate-csp-hashes.mjs --write` (el test anti-drift falla si no se sincroniza)
- D1 local: `schema.sql` primero (crea `properties`), luego `npx wrangler d1 migrations apply nexo-db --local` (0002 hace ALTER sobre properties)

### Session runtime (04.3)
- `session-runtime.js`: cookie `__Host-session` (HttpOnly; Secure; SameSite=Lax; Path=/; sin Domain), token 256-bit base64url, D1 guarda solo SHA-256 hex (idx partial UNIQUE token_hash)
- Absolute 30d; idle NO implementado (schema sin columna de actividad; `last_seen_at` solo auditoría, throttle 15min)
- Concurrencia: máx 5 sesiones/cuenta; la 6ª revoca la más antigua (fail-open)
- Endpoints: `GET /api/session/status`, `POST /api/session/logout` (CSRF: Origin allowlist, `null` rechazado, ausente aceptado; rate limited; no-store)
- CORS credentials SOLO en /api/session/*; SW excluye /api/session/* (Cache API ignora no-store)
- Sesión de usuario ≠ admin: /api/admin/* sigue Bearer ADMIN_TOKEN
- createSession/rotateSession/revokeAllSessions listos para handoff de Authentication (contrato 04.2 §11)
- Docs: SESSION-RUNTIME.md + ADR-013

### Authorization architecture (04.4, FROZEN — solo docs)
- Modelo: RBAC + Ownership (listing_owners) + Explicit Policy Checks → `authorize(actor, action, resource) → ALLOW | DENY`, deny-by-default, fail-closed
- Roles: PUBLIC/USER implícitos (sin fila); OWNER/AGENT = relación por listing (no rol); MODERATOR/ADMIN core; AGENCY future; SUPERADMIN break-glass (0 en prod); SYSTEM actor (actor_type='system', actor_id NULL)
- Sin herencia jerárquica; matriz rol→permiso = constante compilada (fuente única)
- Moderation boundary: create/submit (user) ≠ approve/publish (NEXO); published nunca directo; moderation_events inmutable
- Privilege change ⇒ security_stamp rotation + revokeAllSessions (04.3)
- Serialización whitelist por audiencia (field-level); 404 indistinguible anti-IDOR
- Riesgo de tipos listing_id: RESUELTO en 04.4.1 (ver sección abajo)
- Docs: AUTHORIZATION-ARCHITECTURE.md + ADR-014

### Authorization runtime (04.5)
- Módulo `src/auth/authorization/` (roles/permissions/matrix/actor/resource/ownership/authorize/serialize/audit/index); NUNCA lógica de decisión en endpoints
- `authorize(actor, action, resource, {env})` → `{decision:'ALLOW'|'DENY', reason}`; resuelve recurso + relationship (listing_owners, revoked_at IS NULL) server-side en cada llamada — campos forjados en `resource` se ignoran
- Actor: `resolveActor()` (sesión 04.3 + user_roles current; error de roles → rolesError → todo DENY) o `legacyAdminActor()` (system + plane legacy_admin_bearer); HTTP jamás declara type/roles/plane
- Plano admin: Bearer ADMIN_TOKEN autentica → authorize() decide (lista cerrada LEGACY_ADMIN_PLANE_ACTIONS) → audit `authorization_sensitive_allowed` (actor_type='system', metadata.admin_plane='legacy_bearer') tras éxito; DENY autenticado → audit `authorization_denied`
- Serialización whitelist por audiencia (`serializeProperty`): public/owner/moderator/admin; doble barrera (SELECT público + serializer) en /api/properties*, chat IA solo campos public
- denyResponse: 401 sin auth; 404 indistinguible para no-staff sobre listings; 403 staff
- Sin cache de decisiones, sin migrations, sin endpoints USER CRUD (04.7); workflow moderation → 04.8
- Tests: test/authorization.test.mjs (59: deny-by-default, fail-closed, IDOR/BOLA, escalación H/V, tampering role/owner_id/public_code, serializers, audit, integración worker)
- Docs: AUTHORIZATION.md

### Listing identity (04.4.1)
- Canónico: `properties.id` INTEGER PK (interno/relaciones) + `properties.public_code` TEXT NOT NULL UNIQUE (público: URLs/SEO/IA/Vectorize)
- Generación: tabla `listing_id_sequence` (batch UPDATE+INSERT); fallback MAX(public_code)+retry; jamás COUNT+1
- Resolución dual por patrón en lectura: `listingLookup()` en worker.js (N-XXX → public_code, numérico → id legacy)
- FKs: listing_owners → properties(id) ON DELETE CASCADE; moderation_events INTEGER sin FK (audit sobrevive borrado)
- Migration 0005 **APLICADA EN PRODUCCIÓN** (04.4.3): tracker d1_migrations reconciliado (0001-0005), public_code NOT NULL UNIQUE activo, 0 pérdida; backup pre-apply en /tmp/nexo-backup-0443-*.sql (md5 e638556c)
- Producción real ≠ docs viejas: properties.id siempre fue INTEGER; public_code existía sin uso; admin POST estaba roto (TEXT→INT), ahora reparado
- Tablas legacy vacías sin uso: favorites, user_favorites, users (cleanup futuro)
- Docs: LISTING-IDENTITY.md + ADR-015
- Backup prod: /tmp/nexo-backup-20260821.sql (fuera del repo, no versionar)

### Security headers (04.2.1)
- Baseline en worker.js `withSecurityHeaders()` aplicada en `fetch()` a TODA respuesta (API, SEO, assets, media, 404/500)
- CSP hash-based: script-src sin `unsafe-inline`; hashes sha256 generados desde public/ (9 hashes)
- Excepción documentada: `style-src 'unsafe-inline'` (atributos style= extensos + Leaflet inyecta estilos)
- Guard: `scripts/generate-csp-hashes.mjs` falla si aparece cualquier handler inline (on*=) en HTML
- Handlers inline eliminados de las 6 páginas → delegación `data-action` + addEventListener
- `public/config.js` es código muerto no referenciado (solo teléfono público; candidato a limpieza)

### Estado comprobado este pase
- API pública: sin campos privados (owner_name/owner_phone/internal_notes/address verificados ausentes)
- Coordenadas ausentes persisten como NULL (nunca 0)
- PUT /api/admin/properties/:id valida igual que POST; inexistente → 404
- Modelo IA del chat: `@cf/google/gemma-4-26b-a4b-it` (llama-3 fue deprecado 2026-05-30; era causa de 500 en /api/chat)
- R2 imágenes: formato `/media/*` consistente en D1; objetos existen en producción

### Problemas reales abiertos
- Secrets expuestos en ~/.cf_token / ~/.gh_token (rotar)
- Chat AI no aplicó rate-limit (roadmap P0 A-08a pendiente)

### Gate 18 — Premium Visual Rebuild (2026-08-23, COMPLETADO)
- Frontend rebuild UX/UI completo SIN tocar backend; reporte: reports/FINAL-GATE-18-PREMIUM-VISUAL-UX-AUDIT.md
- Design system v3 en `public/variables.css` (fuente única): `.nx-header__nav`, `.nx-bottomnav` (móvil + safe-area), `.nx-sheet`/`.nx-scrim` (filtros bottom-sheet/móvil, modal/desktop), `.nx-chip` (+`--action` con badge), `.nx-toast`, `.nx-state__icon`, `.nx-price-marker` (markers mapa en home y /mapa/), `.nx-skeleton`, `.nx-reveal`; motion solo transform/opacity, `prefers-reduced-motion` respetado
- Navegación unificada: 1 header + bottom nav en las 6 páginas públicas (antes 3 headers distintos)
- Home: hero centrado, sheet de filtros (FS_KEYS=operation/type/province/bedrooms, case "apply-filters"), fav pop+toast, watchdog 8s anti-spinner-eterno (showState("error"))
- Mapa reescrito: `showNoCoordsState` (nombre canónico, test 14D), sidebar/preview nx-card, aviso tiles caídos
- Property: acento por token `{{BRAND_PRIMARY_COLOR}}` (nunca hardcodear #c2410c), key facts sin ceros
- CSP: 12 hashes en worker.js — tras tocar cualquier `<script>` inline ejecutar `node scripts/generate-csp-hashes.mjs --write`
- SW: `nexo-v10-static-swr` (bump en cada cambio de estáticos)
- Tests: 246/246; CI/CD verde; GITHUB_TOKEN es read-only → push con GITHUB_API_KEY
- Backlog visual: clusters de markers (>100 listings), galería con thumbnails, conversión de moneda UI

## 📐 Especificaciones de arquitectura (docs)
- `identity-architecture.md` — Fase 04.0 Identity & Security spec (ARCHITECTURE READY)
- `identity-architecture-adrs.md` — ADRs 001-011
