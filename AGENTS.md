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
- Tests: `npm test` (5 suites, 73 tests)
- Verificación: `curl .../api/health`
- CSP: tras tocar cualquier `<script>` inline en public/, ejecutar `node scripts/generate-csp-hashes.mjs --write` (el test anti-drift falla si no se sincroniza)

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
