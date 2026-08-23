# PRODUCT SPEC — NEXO

Especificación funcional del producto tal como está **verificado en
producción** (https://nexo-inmueble.luisangelfigueredo02.workers.dev,
2026-08-23). Nada aquí se afirma sin haberse comprobado; las excepciones
están marcadas.

---

## 1. Producto público

| Función | Detalle | Estado |
|---|---|---|
| Home / catálogo | Hero con buscador, trust bar con conteo real de propiedades, grid de cards con badge operación/tipo, precio con moneda, galería | VERIFIED |
| Búsqueda | Texto libre sobre título/zona del inventario publicado; XSS-neutralizada (queries parametrizadas) | VERIFIED |
| Filtros | Operación (venta/alquiler), tipo (casa/apartamento/terreno/penthouse), provincia, habitaciones, precio máx.; chips + bottom-sheet en móvil | VERIFIED |
| Ordenación | Relevancia, más recientes, precio asc/desc, superficie | VERIFIED |
| Ficha de propiedad | `/property.html?id=N-XXX` — galería con navegación, badges, key facts (hab/baños/m², sin ceros), descripción, guía de compra segura (acordeones), propiedades similares, CTA WhatsApp con mensaje prellenado y marca inyectada | VERIFIED |
| SEO de ficha | Meta/OG/JSON-LD inyectados server-side en el HTML; contenido body renderizado en cliente | VERIFIED (limitación documentada) |
| Mapa | `/mapa/` fullscreen — Leaflet self-hosted (fallback CDN), markers con precio compacto, sidebar sincronizado con preview cards, estado explícito si no hay inmuebles geolocalizados, aviso si los tiles fallan | VERIFIED |
| Toggle Lista/Mapa | En home, sin recarga | VERIFIED |
| Comparador | `/comparar/` lado a lado, hasta 5 propiedades (`/api/properties?ids=A,B`), empty state con CTA | VERIFIED |
| Favoritos | Anónimos (localStorage) + persistentes por cuenta; fusión automática al autenticarse; pop + toast en UI | VERIFIED |
| Cuentas | `/cuenta/` — tabs Entrar/Crear cuenta, email+password (PBKDF2-SHA256 100k), cookie `__Host-session` HttpOnly/Secure/SameSite=Lax, logout, favoritos sincronizados entre dispositivos | VERIFIED |
| Asistente IA | `/ia/` + launcher flotante — chat con Workers AI sobre el inventario real; respuestas honestas ante 0 resultados; propiedades emparejadas con enlace; rate limited (10 req/5 min/IP); mensajes >2000 chars rechazados | VERIFIED |
| WhatsApp | CTAs en ficha, home y comparador con mensaje prellenado (`{{BRAND_NAME}}` inyectado); si `WHATSAPP_PHONE` está vacío los CTAs se ocultan sin enlaces rotos | VERIFIED |
| Mobile UX | Bottom nav con safe-area, bottom-sheets de filtros, layout mobile-first verificado a 390px | VERIFIED |
| PWA | Manifest dinámico (nombre/colores desde la marca), service worker con stale-while-revalidate, instalable, iconos 192/512 | VERIFIED |
| SEO global | Title/description/OG por marca, sitemap.xml dinámico (origin real + listings publicados), robots.txt dinámico, canonical, JSON-LD | VERIFIED |
| Modo demo | `DEMO_MODE=1` → banner global "Modo demostración", badge DEMO en cards, watermark DEMO en imágenes; reversible | VERIFIED |
| Legal | `/legal` con privacidad/términos/contacto + atribuciones (Leaflet, OSM, CARTO); plantilla que el comprador debe adaptar a su marco legal | VERIFIED |
| Resiliencia | Watchdog anti-spinner (estado de error con reintento), empty states intencionales, placeholders de imagen propios | VERIFIED |

## 2. Panel de administración (`/admin`)

| Función | Detalle | Estado |
|---|---|---|
| Autenticación | Bearer `ADMIN_TOKEN` (timing-safe); 401 sin/con mal token; plano público nunca habilita admin | VERIFIED |
| CRUD de propiedades | Crear, editar, publicar/despublicar (status), eliminar; validación igual en POST y PUT; inexistente → 404 | VERIFIED |
| Subida de imágenes | Drag & drop + barra de progreso → R2 (`POST /api/admin/upload-image`, validación MIME + 5 MB) | VERIFIED |
| Gestión de galería | Reordenado de imágenes por propiedad | VERIFIED |
| Coordenadas | Mapa Leaflet embebido: clic para fijar lat/lng con precisión; centro inicial desde `/api/config` | VERIFIED |
| CSV | Importación y exportación masiva (columnas documentadas en el panel) | VERIFIED |
| Identidad de listings | Código público automático `N-XXX` (secuencia atómica `listing_id_sequence`, jamás COUNT+1) | VERIFIED |

## 3. Backend

| Componente | Detalle | Estado |
|---|---|---|
| Runtime | Un único Cloudflare Worker (`worker.js` entrypoint + `src/`), Smart Placement, assets estáticos vía `[assets]` con `run_worker_first` | VERIFIED |
| D1 (SQLite) | 21 tablas; `properties` (id INTEGER PK + `public_code` TEXT UNIQUE), `accounts`, `sessions`, `account_favorites`, `rate_limits`, `listing_owners`, `moderation_events`, etc.; migrations 0001–0007 + aplicador idempotente | VERIFIED |
| R2 | Bucket de imágenes; GET/HEAD con negociación WebP/JPEG por `Accept` + `Vary: Accept`, cache immutable 1 año, anti path-traversal | VERIFIED |
| Vectorize | Índice `nexo-index` (768 dims, cosine); upsert al crear propiedades; el chat NO depende del índice (fallback de catálogo) — % indexado actual: UNKNOWN | VERIFIED (índice) / UNKNOWN (%) |
| Workers AI | Chat con modelo gemma (`@cf/google/gemma-4-26b-a4b-it`) y catálogo real en contexto | VERIFIED |
| Sesiones | Token 256-bit, D1 guarda solo SHA-256; absoluta 30 días; máx. 5 sesiones/cuenta; rotación y revocación | VERIFIED |
| Autorización | Módulo `src/auth/authorization/` — RBAC + ownership, deny-by-default, fail-closed, serialización whitelist por audiencia (la API pública jamás expone owner_name/owner_phone/internal_notes/address) | VERIFIED |
| Rate limiting | D1-based por hash de IP: general, login (fuerza bruta → 429), chat IA (scoped) | VERIFIED |
| Seguridad | CSP hash-based (12 hashes, script-src sin `unsafe-inline`), HSTS preload, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP; CSRF por Origin allowlist; CORS credentials solo en rutas de sesión | VERIFIED |
| API pública | `/api/health`, `/api/config`, `/api/properties` (+filtros, ids, :ref, :ref/similar), `/api/chat`, `/api/auth/register|login`, `/api/session/status|logout`, `/api/me/favorites`, `/media/*`, sitemap/robots/manifest | VERIFIED |
| Tests | 249 pruebas, 15 suites (`npm test`), incl. autorización (59), white-label, migrations, seguridad, demo | VERIFIED |
| CI/CD | Push a main → quality gates → tests → deploy automático (GitHub Actions + Wrangler) | VERIFIED |

## 4. Lo que NEXO NO hace (honestidad de producto)

- No procesa pagos ni transacciones.
- No tiene chat interno comprador-vendedor.
- No tiene autenticación social (Google/Facebook).
- No tiene recuperación de contraseña (requiere proveedor de email; P1 abierta documentada).
- No tiene analytics ni monitorización activa (Sentry DSN vacío por defecto).
- No es multi-tenant: cada despliegue sirve UNA marca (white-label por instancia).
- No tiene clustering de markers en el mapa (backlog documentado, relevante >100 listings).
- El detalle de propiedad no es server-rendered en el body (meta/OG sí).
- Datos de mercado (provincias, guía legal de compra) vienen pre-configurados
  para Cuba y requieren edición puntual de código para otro país (rutas
  exactas documentadas en TAKEOVER.md §2).
