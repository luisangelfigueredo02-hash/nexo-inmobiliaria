# FINAL GATE 1 — PRODUCT TRUTH + FULL UX/UI BASELINE

**Proyecto:** NEXO (plataforma inmobiliaria) — https://nexo-inmueble.luisangelfigueredo02.workers.dev
**Método:** Auditoría read-only. Ningún commit, push, deploy, escritura D1/R2/Vectorize ni modificación de código. Toda la evidencia procede de inspección de repositorio, lecturas GET contra producción y navegación real en browser.
**Fecha:** 2026-08-23

---

## 1. EXECUTIVE SUMMARY

**Veredicto: NEXO NO está terminado para venta.** No es una cuestión de arquitectura backend (que es razonablemente sólida); es que un comprador real lo desplegaría y sus usuarios chocarían con cinco bloqueadores de producto en los primeros 60 segundos:

1. **Imágenes rotas para casi todos los navegadores modernos.** El endpoint `/media/*` colisiona su Vary header: petición con `Accept: image/webp` (que Chrome/Firefox/Safari modernos envían siempre) → **HTTP 500** por `headers.set("Vary")` sin valor (TypeError). Bug confirmado con curl en producción. Ninguno de los 190 tests lo detecta.
2. **El mapa está roto en producción.** Reproducido en navegador real: lienzo gris vacío + mensaje de fallback. Causa raíz doble: (a) el único inmueble (N-001) tiene `latitude/longitude = NULL` → 0 marcadores aunque Leaflet cargue; (b) Leaflet se carga únicamente desde `unpkg.com` → si el CDN tercero falla (sandbox, bloqueador, red cubana frágil), toda la página del mapa muere. No hay bundles/fallback local.
3. **Inventario = 1 inmueble DEMO (N-001).** Con 1 item, ni el mapa, ni el comparador, ni la búsqueda, ni la IA demuestran producto real.
4. **Texto placeholder legal visible en producción** en el footer: *"contenido legal pendiente (LEGAL CONTENT REQUIRES HUMAN CONFIRMATION)"*.
5. **No existe sistema de cuentas de usuario público** (no registro, no login, no perfil). Favoritos viven en `localStorage`. La infraestructura de sesión (04.3) es preparación de backend, no producto.

Adicional: el panel admin permite crear/editar/borrar inmuebles pero **no permite subir imágenes ni reordenarlas** (solo pegar URLs). El módulo IA no fue verificable en runtime por la restricción no-writes (el rate-limit escribe en D1): se clasifica UNKNOWN y requiere verificación posterior.

**Posicionamiento más fuerte tras completar: (B) plataforma white-label PropTech.** El diferencial vendible (Worker único, D1+R2+Vectorize+AI integrados, SEO dinámico) se desmorona si la demo no es demo-able.

---

## 2. ACTUAL PRODUCT DEFINITION

NEXO es un marketplace inmobiliaria de un solo tenant (agente/agencia) para el mercado cubano, construido como un único Cloudflare Worker con assets estáticos, base D1, imágenes R2, y un asistente IA basado en Workers AI + Vectorize. Las capacidades de producto hoy:

| Superficie | Capacidad | Estado |
|---|---|---|
| HOME | Listar inmuebles, búsqueda de texto con parsing NL, filtros (operación/tipo/provincia/precio/habs), ordenación, alternar lista/mapa, IA drawer, conteo de resultados | PARTIAL |
| PROPERTY DETAIL | Galería (hero + visor), badges, facts, descripción expandible, guía compra (accordion), WhatsApp CTA, favorito, compartir, mapa, similares | PARTIAL |
| MAP | Split view mapa+sidebar, marcadores-precio, filtro por área visible, preview móvil | FAILED |
| COMPARE | Comparador de favoritos (localStorage), tabla paralela | PARTIAL |
| AI | Chat con contexto de inventario, sugestiones | UNKNOWN (código VERIFIED, runtime no testeado) |
| ADMIN | Token gate, CRUD inmuebles, listado, selector de coords en mapa | PARTIAL |
| API | GET properties (public, whitelist), detail, similar, config, health, sitemap dinámico, media | VERIFIED |

---

## 3. ARCHITECTURE TRUTH

**Arquitectura real (verificada):**
- **worker.js** (935 LOC): routing en cadena de `if` sobre `url.pathname`; endpoints API, SEO dinámico de property.html, sitemap, media R2, chat IA; wrapper `withSecurityHeaders` en todo; delegado a `src/auth/authorization` para la decisión; `session-runtime.js` para sesiones; `rate-limit.js` (contador en D1) para /api/chat, /api/session/*, /api/admin/verify.
- **public/**: 6 páginas (index, property, mapa, comparar, ia, admin), `variables.css` (536 LOC tokens), `sw.js` (SW offline-first), icons, manifest, robots.
- **src/auth/authorization/**: módulos roles/permissions/matrix/actor/resource/ownership/authorize/serialize/audit. Modelo RBAC + ownership. Solo el "plane" legacy admin Bearer se usa realmente en producción.
- **D1 (nexo-db), R2 (nexo-media), Vectorize (nexo-index), Workers AI** vinculados; Smart Placement activo.
- **CI/CD**: GitHub Actions deploy on push main (quality gates grep-based: syntax, tests, peso assets <800KB, grep de skeleton/navigator.onLine/aria).

**Drift y deuda encontrados:**
- `public/config.js`: código muerto confirmado (no referenciado por ninguna página).
- Documentación drift: AGENTS.md dice 188 tests (reales: 190); dice "Chat AI no aplicó rate-limit" pero el código SÍ lo aplica; aclaración de reports.
- `PROPERTY_HTML_TEMPLATE` fallback en worker.js es un shell vacío si falta el asset; rara vez usado.
- Endpoints SPA-style con regex `similarMatch/detailMatch` mezclados con ifs: funciona pero es frágil.
- La sesión/authorization modular pesada (~11 archivos) tiene aún valor cero de producto (no hay usuarios públicos) — complejidad sin UI. Riesgo para buyer-onboarding.
- `recovery/` (dumps de producción) versionado en el repo — no debería estar en VCS.
- `security_stamp`, sessions, accounts y moderation tables existen en migrations pero sin endpoints de registro/login: código preparado pero no vendible como feature.

---

## 4. USER-SYSTEM TRUTH

| Pregunta | Respuesta verificada |
|---|---|
| Registro público | **MISSING** — no hay endpoint ni UI |
| Login público | **MISSING** |
| Logout público | **MISSING** (existe `/api/session/logout` aislado, sin UI y sin sesión previa posible) |
| Persistencia de sesión | **Infra lista, sin producto** (cookie `__Host-session`, D1 hash, revoke>5) |
| Perfil de usuario | **MISSING** |
| Roles públicos | **MISSING** (roles.js existe; nada los asigna) |
| Favoritos vinculados a cuentas | **MISSING** — localStorage `nexo_favs` |
| Recuperación de cuenta | **MISSING** |
| Auth admin | **VERIFIED** — Bearer ADMIN_TOKEN (+ fallback ADMIN_PASSWORD) |
| Autorización admin | **VERIFIED** — authorize() sobre legacy-admin plane, deny-by-default, audit |

**MISSING — PUBLIC USER ACCOUNT SYSTEM.** No se confunde infra con producto.

---

## 5. FULL VISUAL AUDIT (browser real, desktop; móvil = CSS-inferido)

Pantallas navegadas en browser contra producción. Mobile evaluado por CSS (media queries escasas) → PARTIAL.

| Pantalla | Score (0–10) | Hallazgos clave |
|---|---|---|
| Home | **5** | Hero desmaquetado: título/subtítulo desalineados a la izquierda sobre fondo vacío; header con UN solo link ("Comparar"); sin propuesta de confianza; card de inmueble con foto de calidad baja; texto placeholder legal en footer; IA FAB genérico. El diseño no es "premium". |
| Property detail | **6** | Mejor página del producto: hero con contador, badges, facts, accordion de guía de compra, sticky CTA WhatsApp. Floja la tipografía de precio (peso), fotos de baja calidad, mapa oculto por NULL coords, sección similares vacía por inventario. |
| Map | **1** | ROTO — lienzo gris vacío + mensaje de fallback tras watchdog. Inutilizable como demostración. |
| Compare | **4** | Empty state elegante, pero el comparador no puede demostrar nada con 1 inmueble; depende de localStorage que el usuario no entiende. |
| IA page | **4** | Renderiza, tipografía gris sobre off-white ilegible, layout desanclado, chips presentes; comportamiento IA UNKNOWN. |
| Admin (login) | **3** | Token gate funciona, pero visualmente es una caja de login genérica, sin branding ni profesionalidad; el "producto admin" como valor de venta no existe visualmente. |

**Patrones transversales:** tipografía Jerky (Inter system fallback), espaciados inconsistentes, falta de jerarquía de marca, contraste gris-sobre-blanco cuestionable en IA, iconos mezclados (emoji "✨" en CTA), sin micro-interacciones discernibles, header sin nav coherente entre páginas (index: solo Comparar).

---

## 6. UX AUDIT

- **Home vs. objetivos**: (1) qué es NEXO → parcial ("Encuentra tu próximo lugar" + subtitle Cuba); (2) qué hacer → buscador claro; (3) cómo buscar → sí; (4) por qué confiar → NADA (sin sellos, sin conteo, sin testimonios, sin sobre-NEXO); (5) dónde está el inventario → 1 card; (6) acción siguiente → ambigua.
- **Filtros**: chips + "Más filtros" → bottom sheet avanzado (OK). Persistencia en URL (`syncURL`) VERIFIED. Ordenación client-side (VERIFIED).
- **Empty/error/loading**: skeletons + estados dedicados presentes en index (VERIFIED). Overlay "Sin conexión" con `navigator.onLine` (VERIFIED).
- **Property**: CTA WhatsApp con deep-link y texto pre-llenado con public_code (VERIFIED). Favorito local. Falta: breadcrumbs, contact form, num. de referencia visible, política de privacidad (placeholder).
- **Compare**: depende de favoritos; no hay onboarding ni hints en cards de home para comparar explícitamente (solo corazón).
- **Accesibilidad**: aria-labels en controles principales (VERIFIED), skip/targets ~44px parcial, focus-visible débil, contraste IA insuficiente, prefers-reduced-motion respetado en CSS global (variables.css), dark-mode automático por `prefers-color-scheme` (no opt-in — riesgo comercial en venta).

---

## 7. MAP ROOT CAUSE (Part 7)

**Síntoma reproducido:** página `/mapa/` = lienzo gris + "Consultando catálogo…" → tras ~5 s watchdog: "No se pudo cargar el mapa". 

**Causas raíz (multi-capa):**
1. **Datos**: producción tiene 1 inmueble con `latitude=NULL, longitude=NULL` (verificado vía GET /api/properties). `plotMarkers()` filtra `if (!lat || !lng) return;` → **0 marcadores**. Además, el centro inicial se recalcula solo si hay coords; sin coords queda el fallback const. Aunque Leaflet funcionara, el mapa sería tiles vacíos.
2. **Dependencia única de CDN**: Leaflet 1.9.4 se carga exclusivamente desde `https://unpkg.com`. Si unpkg/Leaflet se bloquea (network fragile Cuba, ad-blockers, CSP de tercero, sandbox corporativo), `L` es undefined → `initializeMap()` lanza → NUNCA se ejecuta `loadMapData()` → el sidebar queda en "Consultando catálogo…" hasta que el watchdog de 5 s pone el fallback. No hay `onerror` del script ni fallback local.
3. **Provider de tiles**: Carto `light_all` — coherente con home, pero exige red a `basemaps.cartocdn.com`; preconnect existe, fallback no.
4. **No hay clustering** (`L.marker` por inmueble, sin plugin) ni "buscar en esta área" (filtro por bounds del sidebar verificado: `filterSidebarProperties` sí filtra por map bounds).
5. **Coordenadas missing se persisten como NULL** (correcto), pero el mapa carece de estado vacío explícito cuando `geo.length === 0`: no hay mensaje "sin propiedades geolocalizadas" ni CTA al listado.

**Implementación recomendada (no aplicada):** (a) vendor Leaflet+CSS en `/public/vendor/leaflet/` (self-hosted, elimina SPOF de unpkg y un hash CSP menos), (b) estado vacío explícito cuando 0 inmuebles tienen coords, (c) semilla/demo con coords reales (Part 16), (d) clustering (`leaflet.markercluster` vendored) ante >20 marcadores, (e) tiles con fallback `onerror`.

---

## 8. MEDIA AUDIT

| Caso | Resultado producción | Estado |
|---|---|---|
| GET `/media/n001/photo-01.jpg` Accept: image/jpeg | 200, image/jpeg, cache 1y immutable | VERIFIED |
| GET misma URL con `Accept: image/webp` | **HTTP 500 "Internal Error"** | **FAILED (P0)** |
| `?w=1200` con webp | **500** | FAILED |
| Variante directa `-w400.webp` | 200 image/webp | VERIFIED (variantes existen) |
| Traversal `/media/..%2f..%2fworker.js` | 400 | VERIFIED (guard canónico funciona) |
| Imagen inexistente | 404 | VERIFIED |
| Fallback en <img> | `data-fallback-src` + placeholder.svg | VERIFIED |

**Causa raíz exacta:** `worker.js:452` — en la rama de negociación WebP, tras encontrar variante, `headers.set("Vary")` se llama **sin segundo argumento** → `TypeError` → el try/catch del fetch devuelve 500. Debería ser `headers.set("Vary", "Accept")`. Todo navegador moderno (Accept incluye `image/webp`) rompe. Los 190 tests pasan: ninguno ejerce esta rama contra el endpoint real (los tests de worker-integrity no emulan R2 ni Accept-webp).
**Corolario de arquitectura:** imágenes se suben fuera de banda (manualmente a R2, con variantes pre-generadas); el worker en sí no las genera. Re-size/re-encode no existe → admin incapaz de subir imágenes.

---

## 9. ADMIN AUDIT

Contra repositorio + UI pública de login (sin credenciales, sin intentos):

| Capacidad | Estado |
|---|---|
| Autenticar (token) | VERIFIED (POST /api/admin/verify rate-limited) |
| Crear inmueble | VERIFIED (POST valida campos; genera public_code atómico vía `listing_id_sequence` con fallback MAX+retry) |
| Editar | VERIFIED (PUT valida igual que POST; 404 si inexistente) |
| Publicar / despublicar | VERIFIED vía `status` en el form (enum published/draft) |
| Borrar | VERIFIED (DELETE; limpia Vectorize, falta si victim null) |
| Subir imágenes | **MISSING** — solo input de URL (no hay `BUCKET_IMAGENES.put` en worker: lecturas GET/HEAD únicamente) |
| Reordenar imágenes | **MISSING** — sin UI de orden |
| Precio/moneda/atributos | VERIFIED (currency enum USD/EUR/CUP, normalize null) |
| Coordenadas | VERIFIED (Leaflet picker + campos lat/lng; NULL si ausentes) |
| Metadata (auditoría) | PARTIAL (audit de decisiones, sin UI de ver) |
| Calidad comercial del UI admin | **3/10** — SPA mínima: token en sessionStorage, formularios planos, sin branding, sin validación UX de errores de red 3G, sin avisos de guardado, sin flujo publicación |

---

## 10. PWA AUDIT

- Manifest VERIFIED (name, short_name, icons 192/512, shortcuts, display standalone, lang es).
- Iconos VERIFIED (favicon.ico + PNGs).
- SW VERIFIED: shell cache (SHELL_URLS), versionado `nexo-v6-polish`, estrategia image cache-first, exclusión explícita `/api/session/*` y `/api/admin/*` (correcto), activación con limpieza de caches viejos.
- Riesgos: versión del SW manual (`SW_VERSION` string) → dependencia de disciplina de bump; shell carga `/property.html` pero las páginas mapa/comparar/ia **no están en shell** → offline de esas páginas cae a fallo; installability probable pero no verificable en este entorno → UNKNOWN.

---

## 11. AI AUDIT

- **Runtime NO verificado (UNKNOWN).** Restricción no-writes: `POST /api/chat` pasa por `enforceRateLimit` que hace `INSERT/CREATE TABLE` en D1. Para respetar la regla NO D1 writes, no se enviaron mensajes.
- **Análisis de código (VERIFIED como inferencia):** pipeline = embedding bge-small → Vectorize topK=4 → filtro `status='published'` → serialize whitelist "public" → prompt sistema anti-alucinación con IDs explícitos → Gemma 4 26B. Fallback a LIMIT 3 si vector falla. Correcto en diseño.
- **Riesgos a verificar tras Gate 1:** latencia (embedding+vector+LLM encadenado), comportamiento con 1 solo inmueble (fallback trivial), precisión de precio/moneda (depende del prompt; currency inyectada), cuentas de hallucination con inventario vacío, comportamiento si AI binding falla (500 "Error interno" genérico). El AGENTS.md afirmaba "Chat AI sin rate-limit" — el código SÍ lo aplica → drift documental corregido en esta auditoría.

---

## 12. SEO AUDIT

- `/property.html?id=N-001`: *dynamic SEO funciona* — título de inmueble, meta descripción (truncada 155), canonical con public_code, OG completo (title/desc/image/url/type/locale/site_name), Twitter card, JSON-LD `RealEstateListing` con address + priceCurrency (+geo condicional). VERIFIED.
- Sitemap dinámico VERIFIED (páginas estáticas + inmuebles publicados, incluye N-001). Robots VERIFIED (disallow admin/api, sitemap link). Indexability OK. 
- Limitaciones: URLs `?id=N-001` no semánticas (`/property/N-001` sería mejor); JSON-LD carece de `@id` y de seller/brand; Open Graph sin `og:image:width/height`; timeout/sitemap sin lastmod; imágenes OG rotas por el bug P0 de media (aun cuando el URL existe).

---

## 13. SECURITY AUDIT

| Área | Estado | Evidencia |
|---|---|---|
| Headers | VERIFIED | CSP con hashes sha256 script-src (sin unsafe-inline) — **excepción: style-src 'unsafe-inline' documentada**; HSTS preload; XFO DENY; XCTO nosniff; Referrer; Permissions-Policy; COOP; CORP (media cross-origin, resto same-origin) |
| Auth admin | VERIFIED | constant-time compare; token o password legacy explícito (deprecation marcada) |
| Authorization | VERIFIED (código) | deny-by-default; legacy-admin plane whitelist; audit events; serialize por audiencia; IDOR 404 indistinguible |
| SQL injection | VERIFIED (código) | consultas parametrizadas; tokens de q sanitized ([%_] stripped, slice 120, máx 6 tokens) |
| XSS | PARTIAL | escapeHtml en interpolaciones principales; verify en renderizado de IA/mensajes tras runtime (UNKNOWN); CSP script-src robusto |
| CSRF | VERIFIED | Origin allowlist en session; `null` rechazado; CORS credentials solo /api/session/* |
| R2 traversal | VERIFIED | guard multi-decode; 400/404 |
| Upload validation | N/A | no hay upload |
| Rate limiting | PARTIAL | cubre chat/session/session-verify; **NO cubre /api/properties ni media** (enumeración trivial) |
| Secret exposure | PARTIAL | ningún secreto en repo; tokens + DSN documentados como secrets; AGENTS.md reporta filtrado en ~/.cf_token/~/.gh_token del operador (fuera de repo) — acción: rotar |
| Serialización pública/privada | VERIFIED | GET /api/properties omite owner_*/address/internal_notes — confirmado en producción |

---

## 14. PERFORMANCE AUDIT

Medidas curl reales (región sandbox, EU):
- TTFB `/` = **99 ms**, total 116 ms, HTML 53.6 KB (sin compresión aparente en curl).
- TTFB `/api/properties` = **105 ms**.
- Presupuesto CI: `public/` total ≤ 800 KB (gate).
- Assets: HTML 50–60 KB por página, CSS única ~20 KB, sin JS framework, imágenes con lazy+srcset+decoding async (VERIFIED en código). 
- No se midieron LCP/CLS lab (entorno sin Lighthouse) → UNKNOWN. Preconnects a unpkg/carto en mapa (VERIFIED). SW reduce repeat visits.
- Riesgos: N-001 tiene 11 imágenes ~25 KB cada una (fotos pequeñas — calidad baja comercialmente); srcset en mapa depende de variantes que por el bug P0 fallan en navegadores reales.

---

## 15. WHITE-LABEL AUDIT

| Elemento | Centralizable | Verificación |
|---|---|---|
| Nombre de marca | NO — hardcoded "NEXO" en HTML de las 6 páginas, manifest, JSON-LD, og:site_name, prompts IA | FAILED |
| Logo | NO — SVG inline por página | FAILED |
| Favicon | Parcial — archivo estático reemplazable | PARTIAL |
| Dominio | SÍ — canónicos derivados de `url.origin` | VERIFIED |
| Colores/tokens | SÍ — `variables.css` único | VERIFIED |
| Tipografía | NO — stack system; sin fuente propia identificable como marca | PARTIAL |
| WhatsApp | SÍ — var `WHATSAPP_PHONE` + `/api/config` | VERIFIED |
| Email/company desc | MISSING — no existe campo de contacto email en config; footer hardcoded | MISSING |
| País/moneda/idioma/map | PARCIAL — `MARKET_COUNTRY/LOCALE/DEFAULT_CURRENCY/MAP_CENTER/ZOOM` vars → /api/config; pero es_CU hardcoded en og:locale y JSON-LD `addressCountry:"CU"`; lang="es" fijo | PARTIAL |
| Social links | MISSING | MISSING |

Conclusión: white-label hoy es **20% real**. El producto se vendería por eso — y hoy requiere editar HTML en 6 archivos para rebranding.

---

## 16. DEMO-DATA DESIGN (solo diseño, NO ejecutar)

**Objetivo:** 25 inmuebles demo que hagan el producto demostrable y testeable, claramente marcados como DEMO y borrables en un paso.

**Especificación:**
- **Marcado:** prefijo `DEMO-` en `internal_notes` + campo explícito propuesto `is_demo INTEGER DEFAULT 0` (requeriría migration futura) o, sin migration, `internal_notes LIKE 'DEMO:%'`. Badge "DEMO" en UI pública cuando is_demo=1.
- **Distribución:** 8 casas, 8 apartamentos, 4 penthouses, 5 terrenos; 60% venta / 40% alquiler.
- **Ubicaciones:** La Habana (Miramar, Vedado, Playa, Centro Habana, La Lisa), Matanzas, Santiago de Cuba, Holguín, Villa Clara — con coords reales plausible dentro de cada zona (¡no inventar coords en prod real buyer: el seed es demo!).
- **Precios:** venta 8.500–450.000 USD/EUR; alquiler 150–2.500/mes; mezcla USD (70%)/EUR (20%)/CUP (10%).
- **Atributos:** 1–6 habs, 1–4 baños, área 45–800 m²; algunos con area=NULL y lat/lng NULL para probar estados.
- **Imágenes:** fotos con licencia segura (Unsplash/Pexels license) descargadas a R2 convariantes w400/w800/w1200; nunca hotlink de Google.
- **Vectorize:** upsert del índice por inmueble en el seed.
- **Comandos propuestos (no implementados ni ejecutados):**
  - `npm run demo:seed` → `node scripts/demo-seed.mjs` que (1) INSERT 25 rows con `internal_notes='DEMO:seed-25'`, (2) sube imágenes a R2 (wrangler r2 put), (3) upsert Vectorize, (4) imprime resumen.
  - `npm run demo:clear` → `node scripts/demo-clear.mjs` DELETE WHERE `internal_notes LIKE 'DEMO:%'` + borrado de keys R2 `demo/*` + Vectorize deleteByIds; imprime contadores verificados.
- **Seguridad:** ambos scripts exigen `--confirm` y operan sobre D1 identificado por `wrangler.toml`; nunca en CI automático.

---

## 17. COMPETITIVE BENCHMARK

Principios extraídos de marketplaces premium (Airbnb/Zillow/Redfin) sin copiar marcas:
1. **El mapa ES el producto** — en PropTech el mapa no puede fallar silenciosamente: necesita clustering, empty-state y recovery. NEXO hoy falla esto.
2. **Confianza antes de inventario** — sellos de verificación, recuento de inmuebles, tiempos de respuesta, política legal completa. NEXO muestra placeholder legal — nunca tolerable en un marketplace.
3. **Calidad de foto = calidad de plataforma** — los compradores juzgan el stock por las fotos; se requiere pipeline de subida o al menos normalización. NEXO no puede subir.
4. **Search-as-conversation** — el NL parse de NEXO existe pero sin onboarding ni ejemplos visibles; AI sin estado visible de "buscando".
5. **White-label vendible = theming real** — un solo properties-file no basta; se requiere `theme.json` servido por el worker.

Posición más fuerte tras completar: **(B) White-label PropTech platform** con story (A) consumer demostrable en demo-data. Como (C) code asset, la deuda UX lo deprecia.

---

## 18. REDESIGN SPECIFICATION (spec, NO implementado)

**Principios de diseño**
1. Inventory-first: todo camino lleva a descubrir inmuebles en ≤2 taps.
2. Trust-by-construction: todo texto legal/configurable proviene de config; nada hardcoded.
3. Mobile-first real: bottom sheets, thumbs-reach, safe-area.
4. Resilience-as-feature: cada superficie externa (mapa, IA, media) tiene fallback visible y recuperación.

**Tokens (variables.css — nuevo `theme.json` servido por worker para white-label)**
- Color: `--color-bg:#faf9f7` (cálido); `--color-ink:#1c1917`; `--color-accent:#c2410c` (terracotta NEXO — se mantiene); semantic: `--success:#15803d`, `--danger:#b91c1c`, `--warning:#b45309`; surface: `--color-surface:#fff`; borders: `--color-border-subtle:rgba(28,25,23,.08)`.
- Type: display 34/40 -0.02em, h1 24/32, body 16/24, small 13/18; familia variable con optical sizing (self-hosted woff2, <60 KB).
- Espaciado 4-pt scale: 4/8/12/16/24/32/48/64; radius 8/12/20/full; shadows bajas en claro, elevadas en cards.
- Dark-mode: opt-in explícito (toggle persistido), no `prefers-color-scheme` automático.

**Componentes & pantallas**
- **Nav unificada**:/logo + Explorar / Mapa / Comparar / IA; header con CTA "Publicar" solo si aplica.
- **Hero home**: value prop + searchbar integrada con chips contextuales; trust bar (n inmuebles, ciudades, respuesta promedio).
- **Card de inmueble**: ratio 4:3, foto dominante, badge operación, precio con moneda explícita, quick-fav, quick-compare; skeleton shimmer uniforme.
- **Filters**: en móvil → bottom sheet con contador de resultados live; en desktop → sticky bar; URL siempre sincronizada.
- **Property**: breadcrumbs, galería con thumbs + visor fullscreen, price box sticky con CTA WhatsApp + tel + form contacto, facts grid iconográfico, guía compra, mapa con fallback explícito, similares, footer completo con links legales reales.
- **Map**: tiles vendored + state explícito de vacío/sin-coords; clustering >20; "buscar en esta área"; recovery con retry.
- **Admin**: sidebar nav, lista con thumbnails, form en secciones con validación inline, upload drag&drop con variantes, reorder drag, publish toggle con confirmación, audit log visible.
- **Cuentas (fase posterior)**: login/registro/email-recovery/favoritos sincronizados — gates productivos separados.
- **Estados**: loading (skeleton), empty (ilustración 1-color + CTA), error (mensaje + retry), offline (overlay + reintento automático), no-results (sugerencias de relax de filtros).
- **Animaciones**: 150–250 ms, easing estándar, respeta reduced-motion; view transitions en navegación principal si disponible.

**Mobile**: safe-area inset; FAB IA no tapa contenido (bottom offset ≥ 96px); bottom sheet filtros con drag-to-close; touch-target ≥ 44px; imágenes priority-hint en primera card.

---

## 19. PRIORITIZED BACKLOG

| ID | Prioridad | Evidencia | Pantalla | Causa raíz | Solución propuesta | Esfuerzo | Riesgo | Buyer impact | User impact |
|---|---|---|---|---|---|---|---|---|---|
| B-01 | **P0** | curl 500 `/media/...jpg` Accept webp | Todas las páginas con fotos | `headers.set("Vary")` sin valor → TypeError | `headers.set("Vary","Accept")` + test de integración emulando Accept webp | XS | Bajo | Crítico (imágenes invisibles en navegadores reales) | Crítico |
| B-02 | **P0** | Browser real: mapa gris + fallback | /mapa/ | Leaflet sólo unpkg + 0 inmuebles con coords | Vendor leaflet local; estado vacío explícito; demo coords (B-04) | S | Medio | Crítico | Crítico |
| B-03 | **P0** | Footer placeholder legal visible | Home (+ resto) | Texto hardcoded | Eliminar/emmarcar con config; gate de CI: grep "LEGAL CONTENT" | XS | Bajo | Crítico | Alto |
| B-04 | **P0** | 1 inmueble en GET /api/properties | Todas | No existe demo-seed | Implementar scripts demo-seed/clear (spec Part 16) | M | Medio (exige confirmación explícita) | Crítico | Crítico |
| B-05 | **P0** | No hay upload UI ni endpoint r2.put | Admin | Diseño: solo lectura R2 | Endpoint multipart con validación tipo/tamaño + variantes; UI drag&drop | L | Alto | Crítico | Crítico para operador |
| B-06 | **P0** | Placeholder legal también "human confirmation" en robots visible | Home | Hardcode | Idem B-03 | XS | Bajo | Crítico | Alto |
| B-07 | **P0** | Sin cuentas públicas | Global | Fase 04.3 solo preparación | Decidir MAT: descartar feature en venta (docs) o MVP login/registro (bloqueado por scope) | L | Alto | Crítico | Alto |
| B-08 | **P1** | Dark-mode automático no opt-in | Global | `prefers-color-scheme` media | Toggle opt-in persistido | S | Bajo | Alto | Medio |
| B-09 | **P1** | IA runtime no probado | /ia/ | Restricción no-writes en auditoría (rate-limit escribe D1) | Verificar tras autorización; añadir test IA con MSW-ish mock | S | Bajo | Alto | Alto |
| B-10 | **P1** | Rate-limit no cubre GET /api/properties/media | API | Diseño | Extender limiter a lecturas costosas o al menos log | S | Medio | Medio | Medio |
| B-11 | **P1** | Sin upload → variantes generadas fuera de banda | Media | Pipeline ausente | Pipeline integrado (sub-objetos `-w{400,800,1200}.webp`) — depende B-05 | M | Medio | Alto | Alto (LCP) |
| B-12 | **P1** | Favoritos no sincronizables | Compare | localStorage por diseño | Documentar decisión de producto (o integrar cuentas) | S | Bajo | Medio | Medio |
| B-13 | **P1** | Theme no centralizable | White-label | HTML hardcoded | worker `theme.json` + tokens por config | M | Medio | Crítico (venta) | Bajo |
| B-14 | **P1** | IA page contraste legible IA | /ia/ | Estilo | Aplicar tokens | XS | Bajo | Medio | Medio |
| B-15 | **P2** | Mapa: sin clustering | /mapa/ | no plugin | vendor markercluster | S | Bajo | Medio | Medio |
| B-16 | **P2** | Compare accede a /comparar/ con favoritos; sin hint en cards | Home | Onboarding | "Añadir a comparar" explícito en card | S | Bajo | Medio | Medio |
| B-17 | **P2** | Deploy quality gates greps frágiles | CI | Diseño | Gates a tests reales (incluir media/Acept) | S | Bajo | Medio | Bajo |
| B-18 | **P2** | recovery/ en VCS | Repo | Historia | Excluir de VCS (gitignore) | XS | Bajo | Medio | Bajo |
| B-19 | **P2** | SW sin mapa/comparar/ia en shell | PWA | SHELL_URLS | Incluir todas las páginas en shell si offline-first es promesa | S | Bajo | Bajo | Medio |
| B-20 | **P2** | SEO URL `?id=` no semántica | SEO | Diseño | /property/N-001 rewrite en worker + redirect | S | Medio | Medio | Bajo |
| B-21 | **P2** | `config.js` dead | Repo | Historia | Eliminar tras verificar | XS | Bajo | Bajo | Bajo |
| B-22 | **P3** | Email/social links config | White-label | Missing | Añadir a /api/config cuando existan features | S | Bajo | Medio | Bajo |
| B-23 | **P3** | JSON-LD sin seller/@id | SEO | Design | Enriquecer | S | Bajo | Bajo | Bajo |
| B-24 | **P3** | Métricas LCP/CLS no medidas | Perf | Tooling | Lighthouse CI en staging | S | Bajo | Medio | Bajo |

---

## 20. DEFINITION OF DONE (para cerrar Gate 1 → Gate 2)

NEXO se considera "commercially finished" cuando TODAS se cumplen:

1. `/media/*` responde 200 con y sin `Accept: image/webp`, con `Vary: Accept` correcto; test de integración cubre el caso; las 6 páginas muestran imágenes en Chrome/Firefox/Safari reales.
2. `/mapa/` renderiza tiles y marcadores para inventario demo; estado explícito cuando 0 resultados; funciona si unpkg está caído (Leaflet vendored).
3. El footer no contiene placeholders; toda la cadena legal viene de config.
4. Inventario demo: 20–30 inmuebles con coords reales/plausibles, fotos con licencia, marcados DEMO, con `demo:seed`/`demo:clear` documentados y verificados; `status: published` y is_demo badge en UI.
5. Admin puede subir imágenes (validadas), reordenarlas y publicar/despublicar con confirmación; sesión/token con razonable UX; sin lockout con ADMIN_TOKEN.
6. White-label: cambiar marca/logo/colores/contacto requiere editar ≤2 archivos (theme.json/config) + 0 HTML.
7. Cuentas públicas: decisión explícita de scope documentada (incluir con MVP o excluir como roadmap).
8. SEO: sin issues en Lighthouse SEO (≥90); `?id=` legacy redirige a URL canónica semántica.
9. Rate limit: endpoints costosos cubiertos; IA respondiendo dentro de SLA medido; test IA con resultado esperado contra inventario.
10. `npm test` verde con el caso B-01 incluido; deploy workflow pasa con gates reales; docs sin drift (AGENTS.md dice la verdad).

---

## VEREDICTO FINAL

**¿Está NEXO terminado? NO.** No por arquitectura (sólida y bien auditada) sino porque un comprador no podría enseñarlo sin tropezar, en el primer minuto, con el mapa roto, las imágenes rotas en su navegador real, el placeholder legal y un inventario de 1 inmueble. El camino más corto a "terminado" no es más backend: es el bloque P0 (B-01…B-07) + demo-data + polish premium.

— Fin del reporte Gate 1. Esperando autorización explícita para cualquier implementación.
