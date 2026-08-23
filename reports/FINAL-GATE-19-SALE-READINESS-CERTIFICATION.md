# FINAL GATE 19 — SALE-READINESS CERTIFICATION

**Fecha:** 2026-08-23 · **Modo:** adversarial, read/write, verificación contra producción en vivo
**Producción:** https://nexo-inmueble.luisangelfigueredo02.workers.dev
**SHA desplegado:** `b1c4716` (verificado vía GitHub Actions run → wrangler deploy, `wrangler deployments list` posterior al último deploy)

Clasificación de evidencia: **VERIFIED** (probado contra producción/tests en esta sesión) · **INFERRED** (deducido de código+comportamiento) · **ESTIMATED** · **UNKNOWN**.

---

## 1. Resumen ejecutivo

NEXO fue sometido a una certificación adversarial completa contra producción: 15 rutas públicas, 20+ probes de seguridad, flujos auth end-to-end, batería visual desktop+mobile, auditoría de datos D1/R2/Vectorize y revisión de handover. Se encontraron y **corrigieron en producción** 3 hallazgos reales (2 P1, 1 P2) y se limpió el rastro de la auditoría. El veredicto es **CERTIFICADO PARA VENTA con condiciones menores** (sección 14).

## 2. Hallazgos y correcciones aplicadas en este Gate

| # | Severidad | Hallazgo | Acción | Estado |
|---|-----------|----------|--------|--------|
| A-08a | P1 | `/api/chat` solo tenía límite general 20/min — 12 requests consecutivas → 200 (coste Workers AI por llamada) | `enforceScopedRateLimit(env, request, "ai-chat")` 10 req/5 min/IP en worker.js + test dedicado | **VERIFIED corregido**: 12 requests post-deploy → `200×10, 429, 429` |
| G19-01 | P1 | Mensajes de chat de 100 KB aceptados (200) — gasto de AI por payload abusivo | 400 para `message` no-string o >2000 chars, antes de consumir rate limit + 2 tests | **VERIFIED corregido**: 3000 chars → 400; mensaje válido → 200 |
| G19-02 | P2 | Precios renderizaban sin moneda (`79,717` en vez de `US$79,717`) — el seed nunca escribió `properties.currency` | UPDATE directo en D1 prod (25 filas D-* → USD) + fix en `scripts/seed-demo.mjs` para futuros reseeds | **VERIFIED corregido**: API devuelve `currency:"USD"`, home muestra `US$` |
| G19-03 | Higiene | Rastro de auditoría en D1: 95 filas `rate_limits` expiradas, cuenta de auditoría activa | DELETE de filas expiradas; cuenta audit anonimizada (patrón ADR-008), su sesión eliminada | **VERIFIED**: 95 borradas; `status='deleted'`, email placeholder |

## 3. Certificación funcional (VERIFIED contra producción)

- **Rutas públicas (15/15 → 200):** `/`, `/mapa/`, `/comparar/`, `/ia/`, `/cuenta/`, `/legal`, `/admin`, `/api/health`, `/api/config`, `/api/properties`, `/manifest.webmanifest`, `/sw.js`, `/sitemap.xml`, `/robots.txt`, `/media/n001/photo-01.jpg`.
- **API pública:** 26 propiedades; **sin leaks** de `owner_name`/`owner_phone`/`internal_notes`/`address`; `public_code` presente en todas; N-001 (real) con lat/lng NULL (nunca 0).
- **Chat IA:** responde con modelo activo (gemma), devuelve `properties` emparejadas (query "casa en vedado 3 habs" → sugiere D-001 con precio/detalles reales).
- **Favoritos:** PUT/GET/DELETE OK (quirk documentado: campo `listing`, no `listing_id`); sin auth → 401; listing inexistente → error legible.
- **Auth end-to-end:** register → cookie `__Host-session`; `/api/session/status` con cookie → autenticado; sin cookie → `{authenticated:false}`.
- **Admin:** sin token → 401; token erróneo → 401; POST sin token → 401.
- **SEO:** sitemap OK; home con title/description + 7 og tags; property.html con title dinámico (cliente; la página de propiedad no es server-rendered — UNKNOWN el impacto SEO real, INFERRED bajo para marketplace con búsqueda in-app).

## 4. Certificación de seguridad (VERIFIED)

- **Headers:** HSTS, CSP estricto (script-src hash-based, sin `unsafe-inline`), permissions-policy presentes en `/`.
- **Fuerza bruta login:** 429 tras 10 intentos (scoped rate limit) ✅.
- **CSRF:** logout con `Origin: null` o `Origin: evil` → 403 ✅.
- **CORS:** credentials solo en rutas de sesión ✅.
- **IDOR/BOLA:** `/api/properties/1` (id numérico interno) → 404 indistinguible; `N-999` → 404 ✅.
- **SQLi:** `q=' OR 1=1--` → 0 filas (queries parametrizadas) ✅.
- **XSS:** `<script>` en búsqueda → `[]` sin ejecución ✅.
- **Path traversal:** `/../worker.js` → 400 ✅.
- **Validación:** register sin email → 400; chat payload abusivo → 400 (nuevo) ✅.
- **Secrets:** solo `ADMIN_TOKEN` configurado (`wrangler secret list`); no hay secretos en el repo.
- **Pendiente conocido (documentado en AGENTS.md):** secrets expuestos en `~/.cf_token`/`~/.gh_token` del entorno de desarrollo del propietario — **rotación recomendada** (fuera del alcance del runtime; UNKNOWN si ya se rotaron).

## 5. Certificación visual/UX (VERIFIED con screenshots)

Capturas headless Chromium (1440×900 y 390×844) de producción post-fixes:

- **Home desktop:** hero con búsqueda, trust indicators (26 propiedades · Verificadas · Contacto directo), chips de filtro, cards con badge DEMO, precio `US$` correcto. ✅
- **Home mobile 390:** bottom nav (Explorar/Mapa/Comparar/IA/Cuenta), hero compacto, sin overflow horizontal. ✅
- **Mapa desktop+mobile:** tiles CARTO cargan (verificado en Chromium local — la vista gris del navegador de auditoría remoto era un fallo de red del entorno de auditoría, no del producto: los `<img class="leaflet-tile leaflet-tile-loaded">` existen y las tiles responden 200), markers con precio compacto, sidebar sincronizado, fallback honesto ante tiles caídos. ✅
- **Property mobile (N-001 real):** galería 11 fotos, badge VENTA/APARTAMENTO, título, ubicación, stats (2 hab / 1 baño), CTA WhatsApp prominente. ✅
- **Cuenta mobile:** tabs Entrar/Crear cuenta, form limpio, copy de privacidad. ✅
- **Comparar mobile:** empty state intencional con CTA "Explorar catálogo". ✅
- **IA mobile:** entrada + ejemplos + empty state de asesor. ✅
- **Demo banner:** visible en todas las páginas, no tapa navegación (desplaza headers sticky). ✅

## 6. Integridad de datos e infraestructura (VERIFIED)

- **D1:** migraciones aplicadas 0001–0007 + `0006_public_user_auth` (tracker reconciliado, incluye la histórica `0006_properties_currency`); tablas presentes (accounts, sessions, rate_limits, properties, account_favorites, ia_*…). Inventario: 25 demo (D-*) + 1 real (N-001).
- **R2:** imágenes reales `/media/n001/*` → 200 image/jpeg; placeholders demo `/demo-media/*.svg` → 200.
- **Vectorize:** índice `nexo-index` (768 dims, cosine) existe; upsert en creación de propiedades (worker.js:864,954). UNKNOWN el % de listings indexados actualmente (no hay endpoint de conteo; el chat funciona por fallback de catálogo, no depende del índice).
- **Secrets en prod:** solo `ADMIN_TOKEN`. Vars: `WHATSAPP_PHONE`, `DEMO_MODE=1`, SENTRY_DSN vacío (monitorización no activa — P3).
- **Deploy pipeline:** push → CI (tests 249) → wrangler deploy automático; 3 deploys verificados en este Gate.

## 7. White-label / handover (VERIFIED)

- `/api/config` expone brand, whatsapp_phone, market (CU/es_CU), default_currency, demo_mode.
- Páginas públicas y admin usan placeholders `{{BRAND_NAME}}` etc. (19 en legal.html; admin.html templated).
- `TAKEOVER.md` documenta: seed/clear demo, migraciones, `listing_id_sequence`, rotación. `README.md` + `AGENTS.md` (estado de arquitectura completo) presentes.
- **Dominio:** producción vive en `*.workers.dev` del propietario — el handover de cuenta Cloudflare es un paso comercial, no técnico (documentado).

## 8. Tests y CI (VERIFIED)

- Suite local: **249/249 verde** (245 previos + 1 chat RL + 2 validación chat + 1 ajuste rate-limit).
- `node --check worker.js` ✅.
- CI: 3 runs en este Gate, todos `success` (incluye tests + deploy).

## 9. Commits del Gate

| SHA | Contenido |
|-----|-----------|
| `cf3494c` | Rate limit estricto scoped en /api/chat (A-08a) + test |
| `4a0deda` | Seed demo con currency=USD (+ backfill prod directo) |
| `b1c4716` | Rechazo de mensajes chat >2000 chars / no-string + 2 tests |

Push: 3/3 a `main`. Deploys: 3/3 exitosos y verificados en vivo.

## 10. Backlog restante (no bloqueante)

- **P2:** `lang` y textos en español cubano correctos, pero precios usan locale `en-US` para separador de miles (decisión consciente, consistente) — reconsiderar `es-ES` si el comprador lo prefiere.
- **P3:** Sentry DSN vacío — sin monitorización de errores de frontend en prod.
- **P3:** Property pages no server-rendered (SEO de listings depende de sitemap + JS).
- **P3:** Tablas legacy vacías (`favorites`, `user_favorites`, `users`) pendientes de cleanup.
- **P3:** Rotación de secrets personales del entorno dev (documentada en AGENTS.md).
- **UNKNOWN:** % de listings con embedding en Vectorize; throughput real del chat bajo carga concurrente.

## 11. Definition of Done

[x] Endpoints públicos 200 · [x] API sin leaks · [x] Security headers · [x] Auth E2E · [x] Brute-force 429 · [x] CSRF 403 · [x] CORS correcto · [x] IDOR 404 · [x] SQLi/XSS/traversal rechazados · [x] Chat rate-limited · [x] Chat validado · [x] Precios con moneda · [x] Visual desktop+mobile verificada · [x] Mapa con tiles funcionando · [x] Demo rotulado · [x] D1/R2/Vectorize auditados · [x] Rastro de auditoría limpiado · [x] Tests 249 verdes · [x] CI verde · [x] 3 deploys verificados · [x] Handover docs presentes · [x] Reporte con evidencia clasificada

## 12. Veredicto final

**NEXO está CERTIFICADO como sale-ready.** Los 3 hallazgos encontrados por verificación adversarial fueron corregidos, testeados, desplegados y re-verificados en producción dentro del mismo Gate. No quedan P0 ni P1 abiertos. Las condiciones restantes son de higiene (P2/P3) y un paso comercial (transferencia de cuenta Cloudflare / rotación de secrets personales) que no afectan al runtime.

---

_Generado por un agente IA (OpenHands) durante la certificación Gate 19. Toda afirmación VERIFIED fue probada contra producción en vivo el 2026-08-23._
