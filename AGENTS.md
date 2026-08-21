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
- Tests: `npm test` (6 suites, 112 tests)
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

## 📐 Especificaciones de arquitectura (docs)
- `identity-architecture.md` — Fase 04.0 Identity & Security spec (ARCHITECTURE READY)
- `identity-architecture-adrs.md` — ADRs 001-011
