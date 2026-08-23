# NEXO — FASE 13: INDEPENDENT FINAL FORENSIC AUDIT

**Fecha de auditoría:** 2026-08-23 (UTC)
**Auditor:** Agente independiente (OpenHands) — sin participación en fases 05.x–12
**Modo:** READ-ONLY estricto. Cero escrituras en código, D1 (salvo contadores de rate-limit como efecto lateral inevitable de requests GET/POST de solo lectura funcional), R2, Vectorize. Sin commits, push, deploys ni migraciones.
**Evidencia primaria:** código en `main`, producción `https://nexo-inmueble.luisangelfigueredo02.workers.dev`, API de Cloudflare, API de GitHub, navegador real.
**Evidencia secundaria (no aceptada como verdad):** reports 05.x y fases 06–12.

---

## EXECUTIVE SUMMARY

NEXO es hoy un **MVP técnico sólido y bien ingenieril** de portal inmobiliario sobre Cloudflare (Worker único + D1 + R2 + Vectorize + Workers AI), con seguridad muy por encima de la media de productos de su clase, un sistema de diseño coherente y una cadena GitHub → CI → Cloudflare que funciona.

**NO es, tal como está, una plataforma white-label production-ready vendible.** Tres hechos de evidencia primaria lo impiden:

1. **El repo no puede reproducir producción.** La columna `properties.currency` existe en producción (migration `0006_properties_currency.sql`, aplicada 2026-08-22) pero **no existe ninguna migration ni línea de schema.sql en el repo que la cree**. `worker.js` la usa en INSERT y en todos los SELECT. Un comprador que clone y despliegue desde el repo obtiene un admin roto (500) y un `/api/properties` roto. Esto es un P0 de takeover.
2. **El white-label es parcial.** Hay 13 variables de entorno de marca (`BRAND_NAME`, etc.), pero los textos visibles "NEXO" están hardcodeados como literales en 7 archivos HTML (43 ocurrencias), en `manifest.json`, en los `<title>` de las 7 páginas, en el mensaje de WhatsApp ("Hola NEXO…") y en el system prompt del chat. El propio TAKEOVER.md lo admite. Cambiar marca = editar código.
3. **El producto visible es una demo de 1 propiedad.** 1 inmueble (N-001, sin coordenadas), mapa vacío con mensaje de disculpa, homepage con una sola card en un mar de espacio vacío, 1 cuenta de prueba creada hoy. N-001 es TEST DATA, no un activo.

Adicionalmente: deploys y una migración de auth se aplicaron a producción **minutos antes de esta auditoría** (2026-08-23 11:22–11:40 UTC), es decir, el estado auditado es de horas, no de semanas de estabilidad.

**Veredictos (detalle al final):**
- PRODUCTO: **C — MVP READY**
- VENTA: **🔴 NOT READY** (camino corto y concreto a 🟡, ver backlog 13W)
- DESARROLLO: **SMALL POLISH ONLY**

---

## EVIDENCE MATRIX (resumen)

| # | Afirmación | Estado | Evidencia |
|---|---|---|---|
| 1 | HEAD == origin/main == ba7e2f9 | VERIFIED | `git rev-parse`, `git status` limpio |
| 2 | Assets públicos repo == producción | VERIFIED | cmp byte-a-byte de 7 archivos + sw.js + manifest + variables.css: idénticos |
| 3 | Worker desplegado == repo worker.js | PARTIAL | API de contenido denegada (405); comportamiento API + timing CI↔deploy (11:39:44 CI success → 11:40:20 deployment) coinciden |
| 4 | CI GitHub → Cloudflare funciona | VERIFIED | 3 runs `success` hoy (11:26, 11:28, 11:39) + deployments Cloudflare correspondientes |
| 5 | Columna `currency` sin migration en repo | VERIFIED | `grep currency schema.sql migrations/` = 0; PRAGMA prod la lista; worker.js la usa |
| 6 | Producción tiene 1 propiedad, sin coordenadas | VERIFIED | `/api/properties`: 1 resultado, `latitude:null, longitude:null` |
| 7 | Mapa sin tiles en navegador de auditoría | PARTIAL | Screenshot gris (x2, tras espera); tiles CARTO responden 200 vía curl; causa probable: restricción de red del sandbox. Marcadores: 0 (VERIFIED, sin coordenadas) |
| 8 | Chat IA funciona | VERIFIED | POST /api/chat → respuesta coherente citando [N-001], modelo gemma-4-26b |
| 9 | WebP negotiation + Vary correcto | VERIFIED | `Accept: image/webp` → `content-type: image/webp`, `vary: Accept`, 200 |
| 10 | Media traversal bloqueado | VERIFIED | `/media/../worker.js` y `%2e%2e%2f` → 404 |
| 11 | Sistema de usuarios existe (register/login/logout/favorites) | VERIFIED (código) / PARTIAL (e2e) | Rutas en worker.js + migration 0006 aplicada hoy 11:22 + 1 cuenta/1 sesión/1 favorito en D1. No se ejecutaron escrituras de prueba |
| 12 | Sin recuperación de contraseña ni verificación de email | VERIFIED | Ausente en worker.js y en UI de /cuenta/ |
| 13 | "NEXO" hardcodeado en frontend | VERIFIED | 43 ocurrencias en 7 HTML + manifest + titles + wa.me text |
| 14 | SW cachea /api/me/favorites (GET autenticado) | VERIFIED (código) | sw.js excluye /api/admin/ y /api/session/ pero NO /api/me/ |
| 15 | 202 tests pasan | VERIFIED | `npm test`: 202 pass, 0 fail |
| 16 | Tablas muertas en D1 | VERIFIED | analytics_counters, analytics_events, ia_events, ia_feedback, ia_sessions: 0 referencias en worker.js |
| 17 | Docs drift | VERIFIED | TAKEOVER.md dice migrations 0001–0005 (existe 0006); AGENTS.md dice 188 tests (son 202) y `/api/config.brand` (real: `/api/config`); CHANGELOG dice config.js limpiado (correcto) |
| 18 | DEMO_MODE es solo banner | VERIFIED | worker.js: 1 uso (flag en /api/config); banner solo en index.html; seed/clear manual vía wrangler d1 execute |
| 19 | TTFB producción | VERIFIED | 92–142ms (3 mediciones) |
| 20 | Admin CRUD + CSV + upload + reorder existen | VERIFIED (código + UI gate) | admin.html: export/import CSV, dropzone, reorder, mapa de coordenadas; endpoints con authorize() |

---

## FASE 13A — BASELINE

| Ítem | Resultado | Estado |
|---|---|---|
| HEAD exacto | `ba7e2f93891bfb2105d2122e91ab7c784640cc47` | VERIFIED |
| origin/main | Mismo SHA; working tree limpio; clone shallow (1 commit grafted, sin historia) | VERIFIED |
| Último commit | `ba7e2f9 docs(fases 06-12): reports por fase, DEPLOYMENT/SECURITY/ARCHITECTURE, CHANGELOG` | VERIFIED |
| Último deploy verificable | Cloudflare deployment `e8c4706f…`, version_id `7325d6c5-edcd-40d6-a1fd-f0686952e69a`, 2026-08-23T11:40:20Z, source=wrangler | VERIFIED (API Cloudflare) |
| Relación GitHub→CI→Cloudflare | Push a main → workflow `deploy.yml` (quality-audit: check + tests + budget 800KB + greps AGENTS.md → deploy wrangler). 3 runs success hoy; el deploy de las 11:40:20 sigue 36s al CI success de ba7e2f9 | VERIFIED |
| Drift código repo↔prod | Assets: idénticos byte a byte. Worker: no descargable con el token disponible (405); comportamiento observable coincide | PARTIAL |
| **Drift schema repo↔prod** | **Prod tiene `0006_properties_currency.sql` (2026-08-22) ausente del repo; dos migrations distintas comparten el número 0006; `currency` no se crea desde el repo** | **VERIFIED — P0** |
| Drift datos | Prod: 1 property, 1 account, 1 session, 1 favorite (creados hoy, smoke test). Tablas legacy vacías: favorites, user_favorites, users | VERIFIED |
| Drift docs | TAKEOVER.md: "migraciones 0001–0005" (falso, hay 0006); AGENTS.md: 188 tests (real 202), `/api/config.brand` (real `/api/config`); wrangler.toml comenta `/api/config.brand` (no existe) | VERIFIED |
| Hecho temporal relevante | Migration 0006_public_user_auth aplicada a prod **hoy 11:22:16 UTC**; 3 deploys hoy 11:32–11:40. El sistema de usuarios tiene horas en producción, no semanas | VERIFIED |

## FASE 13B — PRODUCT TRUTH

| Ruta/Endpoint | Estado real | Clasificación |
|---|---|---|
| `/` (home + búsqueda + filtros + sort + lista/mapa toggle) | Funciona; 1 resultado; filtros server-side (`type, operation, price, province, neighborhood, bedrooms, q`) verificados vía API | FUNCIONA |
| `/property.html?id=N-001` | Funciona; SSR inyecta title/description/canonical/OG/Twitter/JSON-LD (47064B vs 43702B estático) | FUNCIONA |
| `/api/properties` (+filtros, `q`) | Funciona (q=coronela → 1; operation=alquiler → []) | FUNCIONA |
| `/api/properties/N-001` y `/9` (dual lookup) | 200 ambos; `NOEXISTE` → 404 | FUNCIONA |
| `/api/properties/N-001/similar` | 200 `[]` (sin inventario comparable) | FUNCIONA, vacío por datos |
| `/mapa/` | Carga Leaflet self-hosted; 0 marcadores (única propiedad sin coordenadas); empty state correcto; tiles grises en sandbox (PARTIAL) | PARCIAL — depende de datos |
| `/comparar/` | Empty state correcto; compara favoritos de localStorage | FUNCIONA, vacío por datos |
| `/ia/` + `/api/chat` | Funciona; Vectorize→fallback D1→Gemma; cita [N-001]; rate limited | FUNCIONA |
| `/cuenta/` + register/login/logout/favorites | Implementado y desplegado hoy; 1 cuenta real en D1; no probado e2e por restricción read-only | PARCIAL (INFERRED funcional) |
| `/admin` + CRUD + upload + CSV | Gate por token; endpoints con authorize(); CSV import/export client-side; dropzone+reorder; mapa de coordenadas | FUNCIONA (código VERIFIED, e2e no ejecutado) |
| `/api/config` | Devuelve marca/mercado/mapa/demo desde env | FUNCIONA |
| `/api/health`, `/api/session/status` | 200 correctos | FUNCIONA |
| `/sitemap.xml` | Dinámico desde D1 (origin dinámico) | FUNCIONA |
| Recuperación de contraseña / verificación email | **No existe** (ni endpoints ni UI) | NO IMPLEMENTADO |
| Moderation workflow (04.8) | Tabla `moderation_events` existe; cero endpoints | SOLO ARQUITECTURA |
| User management admin | No existe | NO IMPLEMENTADO |
| Analytics (analytics_*, ia_*) | Tablas en D1; cero código | DEAD SCHEMA |
| Multi-idioma | No existe (es-CU hardcodeado) | NO IMPLEMENTADO |

**Conclusión 13B:** el núcleo transaccional de lectura funciona de verdad. Lo que falta no es código roto sino **datos** (inventario, coordenadas) y **flujos de cuenta completos** (recovery). No confundir: "chat IA funciona" ≠ "producto útil con 1 propiedad".


## FASE 13C — UX/UI FORENSIC AUDIT

Método: screenshots reales de producción (desktop) de las 7 pantallas + análisis de código (variables.css, media queries, estados). Evaluación exigente contra benchmark PropTech internacional.

### Lo que está bien (VERIFIED)
- **Sistema de diseño real**: tokens en variables.css (color, espacio, sombras, radios), dark mode vía `prefers-color-scheme`, contraste documentado (ink-muted 5.04:1 AA), `--touch-target: 44px`, safe areas (`viewport-fit=cover`, `--safe-bottom`).
- **Property detail es la mejor pantalla**: hero con overlay, badges VENTA/APARTAMENTO, contador 1/11, lightbox ("Ver 11 fotos"), stats cards, price card con CTA WhatsApp verde, accordion "Guía de compra segura" (4 pasos legales Cuba — toque local genuinamente diferenciador).
- **Empty states correctos** en comparar ("No tienes propiedades para comparar" + CTA) y mapa ("sin ubicaciones publicadas" + enlace al listado).
- **Login/registro limpio**: tabs Entrar/Crear cuenta, copy de privacidad, sin fricción innecesaria.
- **Tipografía system stack** (SF Pro/Segoe/Roboto): rápida, pero genérica por definición.
- Iconos SVG inline consistentes en la mayoría de componentes.

### Defectos visibles (VERIFIED, con evidencia)
1. **Glifo tofu "□ NEXO IA"** en el FAB del chat (homepage): el emoji ✨ no renderiza en el entorno auditado y se ve como carácter roto. Amateur y muy visible.
2. **Footer con enlaces muertos**: "Sobre NEXO · Contacto · Privacidad · Términos" son texto plano, no `<a>`. Un comprador/usuario los toca y nada ocurre. No existen páginas legales.
3. **Navegación inconsistente entre páginas**: home = "Explorar · Mapa · Comparar · IA · Entrar"; subpáginas = "Propiedades · Mapa · Comparar · Chat IA" (sin "Entrar"); property = sin nav (solo flecha atrás); cuenta = otra variante. 4 patrones de header distintos.
4. **Enlace azul por defecto** ("Ver descripción completa", #1e4fd6) en una paleta terracota/neutra: rompe la coherencia cromática.
5. **Homepage vacía con 1 card**: el grid deja ~75% del viewport en blanco; la primera impresión es "sitio sin contenido", no "startup premium". La trust-bar ("1 propiedad · Verificadas manualmente") es honesta pero delata la falta de inventario.
6. **Suggestion chips del chat IA** son cajas grises planas sin affordance visual clara.
7. **Stats grid asimétrico** en property (2 cards cuando area=null deja hueco junto al price card).
8. **Título de card truncado** con ellipsis ("Apartamento en La Coronela (5to p…").
9. **Mapa gris** en el entorno de auditoría (ver 13D): si ocurre en redes reales (Cuba, 3G, bloqueos a CDN), es el defecto visual más grave del producto.
10. `theme-color` meta (#faf9f7) ≠ manifest `theme_color` (#1C1917): inconsistencia PWA visible en la barra de sistema Android.

### Evaluación por pantalla (0–10)
| Pantalla | Nota | Comentario |
|---|---|---|
| Homepage | 6 | Limpia pero vacía; hero correcto; trust-bar delata escasez |
| Search/Filters | 7 | Chips + panel "Más filtros" + sort; funcional y ordenado |
| Property card | 6.5 | Correcta; truncamiento y jerarquía mejorable |
| Property detail | 7.5 | La más lograda; guía legal local diferencia |
| Gallery | 7 | Lightbox con contador; sin thumbnails strip visible |
| Map | 4 | Gris + vacío en la práctica actual |
| Compare | 6.5 | Empty state bueno; sin datos que comparar |
| IA chat | 7 | Clara; chips planos; tofu glyph en FAB |
| Login/Register | 7 | Limpia; sin "olvidé contraseña" |
| Account/Favorites | 6.5 | Funcional, austera |
| Admin | 6 | Utilitaria; gate de token crudo ("Token de Seguridad") |
| Footer | 4 | Links muertos = defecto de producto terminado |
| Loading states | 7 | Skeletons presentes (CI los exige) |
| Offline states | 7 | SW + navigator.onLine; placeholder SVG de imagen |

### Veredicto UX/UI
"¿Parece una startup PropTech profesional?" — **Una startup early-stage ordenada, no un producto premium.** El sistema de diseño es serio; la ejecución tiene defectos de acabado (tofu, links muertos, nav inconsistente) que un director de producto de Airbnb/Zillow/Idealista rechazaría en review. Contra el benchmark internacional está **2–3 niveles por debajo**; contra el benchmark cubano (Revolico, Porlalivre) está **claramente por encima**. **Puntuación UX/UI global: 6/10.**


## FASE 13D — MAPA

| Ítem | Resultado | Estado |
|---|---|---|
| Leaflet | 1.9.4 self-hosted en `/vendor/leaflet/` (js+css+imágenes) | VERIFIED |
| Fallback | Si el asset local falla → CDN unpkg (CSP permite unpkg en script-src/style-src) | VERIFIED (código) |
| Tiles | CARTO `light_all` (`{s}.basemaps.cartocdn.com`), preconnect declarado; servidores responden 200 vía curl | VERIFIED (disponibilidad servidor) |
| Tiles en navegador | **Grises en el sandbox de auditoría** (2 screenshots tras espera). Causa no determinable aquí: restricción de red del sandbox es la hipótesis más probable; no hay fallback de tiles ni mensaje de error de tiles | PARTIAL/UNKNOWN |
| Sin coordenadas | Empty state explícito: "Mapa sin ubicaciones publicadas" + CTA al listado. La única propiedad (N-001) tiene lat/lng NULL | VERIFIED |
| Markers | Price-markers con divIcon, click→popup, sync con sidebar; promedio de coords para centrado | VERIFIED (código) |
| Clustering | **No existe** (array plano de markers). Con 100+ inmuebles será un problema visual y de rendimiento | VERIFIED (ausente) |
| Error handling tiles | No hay `tileerror` handler ni retry ni capa alternativa (p.ej. OSM estándar) | VERIFIED (ausente) |
| Mobile UX | Layout mapa+sidebar; no verificado en dispositivo real | UNKNOWN |
| Dependencia de red | Tiles externos (CARTO) = punto único de fallo visual; Leaflet ya es local | VERIFIED |
| Admin geolocalización | Clic en mapa para fijar coordenadas (admin.html) | VERIFIED (código) |

**¿El mapa está listo para vender?** **NO como diferenciador; SÍ como funcionalidad base condicionada.** El código es correcto y el empty state es honesto, pero: (a) hoy muestra un mapa vacío — el comprador no ve ni un marcador en la demo; (b) sin clustering no escala; (c) sin fallback de tiles, una red que bloquee CARTO (escenario real en Cuba) deja un rectángulo gris. El seed demo (25 propiedades con coordenadas reales) existe precisamente para resolver (a), pero **no está aplicado en producción**.

## FASE 13E — SISTEMA DE USUARIOS

| Capacidad | Estado | Evidencia |
|---|---|---|
| ¿Existe sistema de usuarios públicos? | SÍ | worker.js `/api/auth/*` + `/api/me/favorites` + migration 0006 + /cuenta/ |
| Registro | IMPLEMENTADO (código VERIFIED; e2e INFERRED — 1 cuenta existe en D1, creada hoy) | PBKDF2-SHA256 100k, validación email/password, 409 duplicado |
| Login | IMPLEMENTADO (mismo criterio) | Respuesta uniforme anti-enumeración, sesión __Host-session |
| Logout | IMPLEMENTADO | POST /api/session/logout con CSRF Origin-check |
| Sesión | Cookie `__Host-session` HttpOnly+Secure+SameSite=Lax; token 256-bit; D1 guarda SHA-256; absolute 30d; máx 5 sesiones/cuenta | VERIFIED (código session-runtime.js) |
| Expiración | Absoluta 30d; **sin idle timeout** (documentado) | VERIFIED |
| Favoritos persisten | SÍ, server-side por cuenta + merge de localStorage al autenticarse | VERIFIED (código + 1 favorito en D1) |
| ¿Acceso a datos de otra cuenta? | No por la vía auditada: favorites filtran por `session.accountId`; 401 sin sesión | VERIFIED (código) |
| Recuperación de contraseña | **NO EXISTE** | VERIFIED |
| Verificación de email | **NO EXISTE** (cualquier email sintáctico registra) | VERIFIED |
| Password hashing | PBKDF2-SHA256 100k iter (límite de Workers), salt 128-bit, comparación constante | VERIFIED |
| Rate limiting auth | 20 req/min/IP vía D1, fail-open | VERIFIED |
| Error handling | Uniforme, sin leak de existencia de cuenta | VERIFIED |
| ¿Obligatorio para MVP? | Registro/login/favoritos: suficiente. **Recovery: sí es obligatorio para operación real** — sin proveedor de email, una cuenta olvidada es irrecuperable | — |

**Nota:** el sistema tiene **horas** en producción (migration aplicada hoy 11:22 UTC). Madurez operativa: UNKNOWN.


## FASE 13F — ADMIN / OPERACIÓN (perspectiva comprador NO técnico)

| Tarea | ¿Puede? | Vía | Clasificación |
|---|---|---|---|
| Crear propiedad | SÍ | Form admin (validación server-side) | OPERADOR |
| Editar propiedad | SÍ | Mismo form (PUT valida igual que POST; 404 si no existe) | OPERADOR |
| Eliminar propiedad | SÍ | DELETE con audit | OPERADOR |
| Publicar / despublicar | SÍ (campo `status` published/draft) | Form | OPERADOR |
| Subir imágenes | SÍ | Dropzone → R2 (JPEG/PNG/WebP, máx 5MB) | OPERADOR |
| Ordenar imágenes | SÍ | Reorder en galería admin | OPERADOR |
| Importar CSV | SÍ | Client-side, 19 columnas | OPERADOR (con cuidado) |
| Exportar CSV | SÍ | Client-side | OPERADOR |
| Gestionar inventario | SÍ | Lista "Inmuebles Almacenados" | OPERADOR |
| Cambiar configuración (marca, WhatsApp, país, mapa) | **NO desde UI** | Editar `wrangler.toml` + redeploy | DESARROLLADOR |
| Cambiar marca visible (textos "NEXO") | **NO sin código** | Editar 7 HTML + manifest | DESARROLLADOR |
| Gestionar usuarios | **NO EXISTE** | — | NO IMPLEMENTADO |
| Obtener token admin | NO solo | `wrangler secret put ADMIN_TOKEN` | DESARROLLADOR |
| Operar el día a día | SÍ, una vez dentro con el token | /admin | OPERADOR |

**Realidad:** un operador no técnico puede gestionar inventario al 100%. Todo lo que es identidad/configuración/plataforma requiere desarrollador (o al menos alguien cómodo con wrangler + git). El gate de admin es un único token compartido (con fallback `ADMIN_PASSWORD` legacy documentado para deprecation): sin 2FA, sin roles, sin caducidad — aceptable para 1 operador, insuficiente para equipo.

## FASE 13G — WHITE-LABEL FORENSIC

| Elemento | Estado | Evidencia |
|---|---|---|
| BRAND NAME | **CONFIGURABLE WITH MINOR CODE** | `BRAND_NAME` env → /api/config y SSR property; pero 43 literales "NEXO" en 7 HTML + titles + manifest no lo consumen |
| LOGO | CONFIGURABLE WITH MINOR CODE | `BRAND_LOGO` env existe; el logo visible es texto "NEXO" en headers (editar HTML); iconos PWA son archivos en /icons/ |
| COLORS | CONFIGURABLE WITH MINOR CODE | `BRAND_THEME_COLOR` env → config; pero variables.css fija `--color-accent: #c2410c` y manifest/theme-color hardcodean hex |
| DOMAIN | CONFIGURABLE WITHOUT CODE | Custom domain en Cloudflare; sitemap/canonical/OG usan `url.origin` dinámico. Punto fuerte real |
| WHATSAPP | CONFIGURABLE WITHOUT CODE* | `WHATSAPP_PHONE` env → /api/config; *pero hay fallback hardcodeado `+5358385702` en worker.js y 3 HTML, y el texto del mensaje dice "Hola NEXO" (property.html:741) |
| SOCIAL | CONFIGURABLE WITHOUT CODE | `SOCIAL_*` env → /api/config (footer no los renderiza como links — ver 13C) |
| COUNTRY / LOCALE | CONFIGURABLE WITH MINOR CODE | `MARKET_COUNTRY/LOCALE` env; pero "Cuba" aparece hardcodeado en index.html (4x), property.html, JSON-LD `addressCountry:"CU"` (worker.js), `og:locale es_CU` |
| CURRENCY | CONFIGURABLE WITHOUT CODE | `DEFAULT_CURRENCY` env; validación acepta USD/EUR/CUP |
| SEO (title/desc/OG) | CONFIGURABLE WITH MINOR CODE | `BRAND_DESCRIPTION` env → SSR property; titles de páginas estáticas hardcodeados |
| CONTACT INFO | CONFIGURABLE WITHOUT CODE | `CONTACT_EMAIL/PHONE/BUSINESS_ADDRESS` env → /api/config (no se muestran en UI pública) |
| DEMO MODE | CONFIGURABLE WITHOUT CODE | `DEMO_MODE=1` → banner (solo index.html) |
| MAP CONFIG | CONFIGURABLE WITHOUT CODE | `MAP_CENTER_LAT/LNG/ZOOM` env |
| BUSINESS INFO | CONFIGURABLE WITHOUT CODE | vía env (limitado a lo anterior) |
| JSON-LD | HARDCODED (parcial) | `addressCountry: "CU"` literal en worker.js |
| Sitemap | CONFIGURABLE WITHOUT CODE | 100% dinámico |
| Manifest / PWA name | HARDCODED | `manifest.json` estático: name/short_name "NEXO", description Cuba |
| Textos legales/footer | HARDCODED / AUSENTE | No hay páginas legales |

**Resumen 13G:** de 17 elementos, 6 son configurables sin código, 7 con código menor, 3 hardcoded, 1 ausente. **La promesa "cambiar de marca sin tocar código" hoy es FALSA para lo más visible: el nombre de marca en pantalla.**


## FASE 13H — DEMO MODE

| Pregunta | Respuesta | Estado |
|---|---|---|
| ¿Cómo se activa? | `DEMO_MODE="1"` en wrangler.toml + redeploy → banner "🧪 Modo demostración" | VERIFIED |
| ¿Cómo se desactiva? | `DEMO_MODE="0"` + redeploy | VERIFIED |
| ¿Qué datos usa? | **Los mismos de producción.** DEMO_MODE solo muestra un banner; NO cambia datos. Los datos demo son SQL generado por `scripts/seed-demo.mjs` (25 props, coords reales Cuba, `public_code D-001…D-025`, marca 'DEMO' en internal_notes) aplicado manualmente con `wrangler d1 execute` | VERIFIED |
| ¿Son claramente ficticios? | Parcialmente: títulos/descripciones genéricas realistas; **sin imágenes** (`images:"[]"` → placeholder); prefijo D- distinguible de N- | VERIFIED (código seed) |
| ¿Contaminan producción? | SÍ — se insertan en la tabla `properties` real con `status='published'`. No hay namespace/tenant separado | VERIFIED |
| ¿Aparecen como reales? | En la API y el frontend son indistinguibles salvo el prefijo D- y el banner (banner SOLO en index.html; /mapa/, /comparar/, /ia/ no lo muestran) | VERIFIED |
| ¿El banner funciona? | Existe y se activa por /api/config; cobertura parcial (1 de 6 páginas) | PARTIAL |
| ¿Demo convincente para un comprador? | Con seed aplicado: sí en listado/mapa (25 puntos con coords); NO en detalle (sin fotos) | INFERRED |
| ¿Existe seed? | SÍ (`seed-demo.mjs` → demo-seed.sql) | VERIFIED |
| ¿Existe clear? | SÍ (`--clear` → demo-clear.sql, borra por marca DEMO) | VERIFIED |
| ¿Reversible? | SÍ, si el clear filtra correctamente por la marca (no ejecutado) | PARTIAL |
| ¿Puede destruir datos reales? | El seed no (INSERT); el clear borra por criterio — riesgo operativo si el criterio falla; ejecución manual sin confirmación interactiva | PARTIAL |
| Estado actual producción | DEMO_MODE=0, seed NO aplicado | VERIFIED |

**Veredicto 13H:** el demo mode es un **procedimiento manual de dos pasos (SQL + env), no un modo de producto**. Funciona para una demo guiada por el vendedor; no es el "Demo Mode opcional" llave en mano que un comprador espera.

## FASE 13I — MEDIA / IMÁGENES

| Ítem | Resultado | Estado |
|---|---|---|
| R2 serving | `/media/*` desde BUCKET_IMAGENES; GET/HEAD | VERIFIED |
| MIME validation upload | Por `Content-Type` declarado (jpeg/png/webp); **sin magic-bytes** — un archivo renombrado pasaría; mitigado por serving con content-type guardado y CSP | PARTIAL |
| Tamaño máx | 5MB | VERIFIED |
| Nombres | `uploads/<uuid>.<ext>` — sin colisión ni traversal | VERIFIED |
| Variantes WebP | `-w400/800/1200.webp` servidas por content-negotiation si existen. **Las subidas por admin NO generan variantes** (solo las tiene el seed n001); fallback al original | PARTIAL |
| WebP verificado | photo-01: 25.3KB jpg → 10.3KB webp; `content-type: image/webp`, `Vary: Accept` | VERIFIED |
| **Bug antiguo `headers.set("Vary")`** | **Corregido y no reaparece**: `headers.set("Vary","Accept")` solo en rama de negociación; CHANGELOG lo documenta; test de integración lo cubre (worker-integrity/security-headers suites) | VERIFIED |
| Cache | `public, max-age=31536000, immutable` + etag | VERIFIED |
| CORP | `cross-origin` solo en /media/ (permite embeds); `same-origin` resto | VERIFIED |
| Traversal | Guard canónica multi-decode (3 iteraciones); `/media/../worker.js` y `%2e%2e` → 404 | VERIFIED |
| Overwrite | Imposible (UUID keys) | VERIFIED |
| Delete | **No existe** endpoint de borrado de imágenes (ni al borrar propiedad) → R2 crece con huérfanos | VERIFIED (ausente) |
| Broken images | Placeholder SVG vía SW offline + `icons/placeholder.svg` | VERIFIED |
| Responsive images | `?w=` negotiation server-side; uso en frontend parcial | PARTIAL |

**Veredicto 13I:** serving de imágenes production-ready. Pipeline de upload: funcional pero sin variantes ni delete — deuda operativa menor.


## FASE 13J — SECURITY (auditoría adversarial, no destructiva)

### Headers (VERIFIED en producción)
CSP hash-based sin `unsafe-inline` en script-src (12 hashes sha256 + unpkg); `style-src 'unsafe-inline'` (excepción documentada); HSTS 2 años + preload; XFO DENY + frame-ancestors 'none'; XCTO nosniff; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy restrictiva; COOP same-origin; CORP por ruta. **Nivel: excelente para su clase.**

### Matriz de amenazas
| Amenaza | Resultado | Severidad |
|---|---|---|
| SQL Injection | Queries 100% parametrizadas (bind); `q` sanitiza `%_` y limita tokens | Mitigada — VERIFIED (código) |
| XSS | CSP hash-based; `escHtml/escJson` en SSR; serializeProperty whitelist | Mitigada — VERIFIED (código) |
| CSRF | Origin allowlist en rutas state-changing; `null` rechazado; SameSite=Lax | Mitigada — VERIFIED |
| IDOR/BOLA | Favorites por accountId de sesión; 404 indistinguible; serialize por audiencia | Mitigada — VERIFIED (código) |
| Auth bypass admin | Bearer + timingSafeEqual; authorize() fail-closed; 401 sin token (probado) | Mitigada — VERIFIED |
| Session fixation/replay | Token 256-bit nuevo por login; hash en D1; rotación disponible | Mitigada — VERIFIED (código) |
| Cookie security | __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/ | VERIFIED |
| Password security | PBKDF2 100k (techo de Workers; por debajo del ideal OWASP 210k+ — limitación de plataforma documentada) | P3 |
| Rate limiting | 20/min/IP en auth/session/chat/admin-verify; fail-open si D1 falla | P3 (fail-open aceptado) |
| **SW cachea GET /api/me/favorites** | sw.js excluye /api/admin/ y /api/session/ pero **no /api/me/**; respuesta 200 autenticada queda en Cache API del dispositivo pese a no-store. Riesgo: dispositivo compartido ve favoritos tras logout | **P2** |
| R2 traversal | Guard multi-decode; probado 404 | Mitigada — VERIFIED |
| File upload abuse | Sin magic-bytes; 5MB; UUID keys; serving con content-type propio + nosniff | P3 |
| CORS | No refleja orígenes arbitrarios (probado evil.com → sin ACAO); credentials solo en session routes | VERIFIED |
| Secret exposure | ADMIN_TOKEN/SENTRY_DSN vía secrets; repo limpio de secretos; **AGENTS.md reporta tokens en ~/.cf_token y ~/.gh_token del entorno del desarrollador — rotación pendiente** | **P1 (higiene de entrega)** |
| PII leakage | API pública sin owner_name/phone/address/internal_notes (serialize public verificado en respuesta real) | VERIFIED |
| API enumeration | Login/register uniformes; 404 indistinguible en listings | VERIFIED |
| Unauthenticated writes | Todas las escrituras tras auth admin o sesión + rate limit (código; no se probaron escrituras) | VERIFIED (código) |
| Admin token único compartido, sin 2FA/expiración | Riesgo de takeover si se filtra; sin rotación forzada | P2 |
| Chat IA prompt injection | System prompt fija contexto; el usuario puede intentar override — riesgo bajo (solo lee datos públicos) | P3 |
| security.txt | Ausente (404) | P3 |

**Sin P0.** La postura de seguridad es el punto más fuerte del producto.

## FASE 13K — PERFORMANCE

| Métrica | Valor | Estado |
|---|---|---|
| TTFB `/` | 92–142ms (3 mediciones, edge ORD/ATL) | VERIFIED |
| HTML home | 59.7KB (sin comprimir; brotli en tránsito) | VERIFIED |
| CSS total | 17.5KB único (variables.css) + inline por página | VERIFIED |
| JS terceros | Leaflet 147.6KB self-hosted (solo páginas de mapa) | VERIFIED |
| Fonts | System stack — 0 webfonts, 0 FOUT | VERIFIED |
| Imágenes | WebP 10–14KB vs JPG 25–81KB; lazy vía navegador; placeholder SVG | VERIFIED |
| Presupuesto CI | 800KB public/ enforceado en workflow | VERIFIED |
| Dependencias de red externas | Tiles CARTO + unpkg (fallback) + Sentry (opcional, vacío) | VERIFIED |
| LCP/CLS/INP | **UNKNOWN** — Lighthouse no disponible en el entorno; no se inventan métricas | UNKNOWN |
| 3G/Cuba | Payload inicial pequeño (~80KB CSS+HTML + 1 imagen ~12KB webp); SW "Modo Isla" con SWR 5min/30min; offline shell | INFERRED bueno (código VERIFIED) |

**Veredicto:** ingeniería de rendimiento seria (budgets en CI, media optimizada, cero frameworks). Las métricas de campo son UNKNOWN.


## FASE 13L — PWA

| Ítem | Estado | Detalle |
|---|---|---|
| manifest | VERIFIED | Válido: id, name, icons 192/512, display standalone, start_url /, scope /, shortcuts |
| Icons | PARTIAL | PNG 192/512; **sin maskable**; placeholder.svg |
| display/theme | PARTIAL | standalone OK; theme_color #1C1917 ≠ meta theme-color #faf9f7 (inconsistencia) |
| Service worker | VERIFIED | Versionado (`nexo-v7`), limpieza de caches viejos, skipWaiting+claim |
| Cache strategy | VERIFIED | Imágenes cache-first; API SWR (5min inventario/30min detalle); navegación network-first con fallback por shell |
| Offline shell | VERIFIED | SHELL_URLS precache; fallback /property.html con ignoreSearch |
| Stale content | PARTIAL | SWR con edad limitada; riesgo de detalle de propiedad stale hasta 30min |
| Updates | VERIFIED | Version bump manual de SW_VERSION invalida caches |
| Installation | PARTIAL | Cumple criterios básicos installability (manifest+SW+icons); prompt no verificado |
| iOS/Safari | PARTIAL | apple-touch-icon presente; SW soportado iOS 11.3+; **no verificado en dispositivo**; safe-area declarada |
| Fuga sesión vía SW | VERIFIED (defecto) | /api/me/favorites cacheable — ver 13J P2 |

## FASE 13M — SEO

| Ítem | Estado | Detalle |
|---|---|---|
| Title/description | PARTIAL | Home/estáticas hardcodeadas "NEXO"; property con SSR dinámico (VERIFIED: title inyectado en HTML servido) |
| Canonical | VERIFIED | property: canonical absoluto dinámico; home: ausente |
| OG/Twitter | VERIFIED | Completos en property (og:title/desc/image/url/locale/site_name, twitter:card summary_large_image); home: OG estático parcial |
| JSON-LD | PARTIAL | RealEstateListing en property (VERIFIED); **addressCountry "CU" hardcoded**; sin JSON-LD en home (Organization/WebSite ausentes) |
| robots.txt | VERIFIED | Allow /, Disallow /admin, /api/; Sitemap referenciado |
| sitemap.xml | VERIFIED | Dinámico desde D1, origin dinámico, cache 1h |
| Property URLs | PARTIAL | `/property.html?id=N-001` — query param, no slug limpio `/propiedad/N-001-apartamento-coronela`. Indexable pero subóptimo para CTR/SEO |
| SSR | VERIFIED | Meta críticos server-side; contenido del listado es client-render (home sin SSR de cards) |
| Duplicate titles | VERIFIED OK | Cada página tiene title distinto |
| Image SEO | PARTIAL | Imágenes con URLs estables; alt genéricos |
| Indexabilidad | VERIFIED | Sin noindex en páginas públicas; /cuenta/ tiene noindex (correcto) |

**Veredicto 13M:** SEO técnico por encima de la media (SSR de metas + JSON-LD + sitemap dinámico). No "SEO-ready" completo: URLs con query param, sin JSON-LD de organización, marca hardcodeada en titles. Para Cuba (mercado con SEO local débil) es más que suficiente; para competir internacionalmente, no.

## FASE 13N — ARCHITECTURE

| Ítem | Evaluación |
|---|---|
| Worker único | Correcto para el tamaño del producto; `worker.js` de 1113 líneas es un **god object en crecimiento** (routing+auth+admin+chat+SEO+media en un archivo) — mitigado por `src/auth/authorization/` modular |
| src/ | authorization/ bien factorizado (9 módulos, decisión fuera de endpoints); passwords.js limpio |
| D1 | Uso razonable; **schema drift currency (P0)**; tablas muertas (analytics_*, ia_*, legacy favorites/users/user_favorites) |
| R2 | Correcto; sin lifecycle/delete |
| Vectorize | Integrado con fallback graceful (chat funciona aunque falle) |
| Workers AI | gemma-4-26b (tras deprecación de llama-3) + bge-small embeddings |
| Sessions/Auth | session-runtime + authorization runtime serios, audit trail incluido |
| Migrations | 6 en repo; **colisión de numeración 0006 en prod (dos archivos distintos)**; d1_migrations reconciliado |
| CI/CD | Funciona; quality gate real (tests, budget, greps); deploy automático |
| Dead code | Mínimo en código (0 TODO/FIXME); config.js eliminado; `PROPERTY_HTML_TEMPLATE` fallback casi muerto; recovery/ (996KB) y repomix (208KB) **versionados en el repo** — artefactos de proceso que no deberían entregarse |
| Documentation drift | Verificado en 4 puntos (ver 13A) |

**Veredicto 13N:** arquitectura buena para el problema, con higiene de repo/schema mejorable. No es "compleja por compleja": cada binding se usa (excepto las tablas muertas).


## FASE 13O — TAKEOVER TEST (simulación comprador técnico)

| Paso | ¿Lo logra? | Fricción |
|---|---|---|
| 1. Clonar | SÍ | Repo público/privado transferible; historia squashed (1 commit shallow) — pierde contexto de evolución |
| 2. Configurar secrets | SÍ | TAKEOVER.md §7 lista ADMIN_TOKEN, SENTRY_DSN; falta mencionar CLOUDFLARE_ACCOUNT_ID para CI |
| 3. Configurar Cloudflare | SÍ | wrangler.toml completo con bindings y IDs — **debe cambiar database_id/bucket/index a los suyos** |
| 4. Crear D1 | SÍ | Documentado |
| 5. Ejecutar migrations | **FALLA PARCIAL** | schema.sql + 0001–0006 del repo **no crean `currency`** → admin POST 500, /api/properties 500. **Bloqueante P0** |
| 6. Configurar R2 | SÍ | Binding directo |
| 7. Vectorize/AI | SÍ | Bindings declarados; índice se puebla al crear propiedades |
| 8. Conectar GitHub | SÍ | deploy.yml + 2 secrets |
| 9. Desplegar | SÍ (tras arreglar paso 5) | CI verde hoy |
| 10. Cambiar branding | **DOLOROSO** | 13 env vars + editar 7 HTML + manifest + wa.me text + JSON-LD country. 1–2 días de trabajo cuidadoso |
| 11. Cargar propiedades | SÍ | Admin UI o CSV |
| 12. Cambiar dominio | SÍ | Custom domain; URLs dinámicas |

- **TIME TO FIRST DEPLOY:** 2–4 h si conoces Cloudflare; **roto hasta arreglar el P0 de currency** (un comprador que no sepa diagnosticar "no such column: currency" abandona).
- **TIME TO WHITE-LABEL:** 1–2 días de edición de código + assets (logo, iconos).
- **DEPENDENCIAS HUMANAS:** 1 desarrollador full-stack con experiencia Cloudflare para takeover y rebrand; operador no técnico solo para inventario.
- **PUNTOS DE FALLA:** currency drift; wrangler.toml con IDs del vendedor; tokens del entorno del vendedor sin rotar; seed demo manual.
- **DOCUMENTACIÓN FALTANTE:** migration 0006 currency; guía de rebrand paso a paso con checklist de archivos; runbook de seed/clear demo; lista de tablas legacy a limpiar; actualización de TAKEOVER.md (0001–0005 → 0001–0006).

## FASE 13P — LICENSING / LEGAL

| Componente | Licencia | Riesgo para venta comercial |
|---|---|---|
| Código propio | MIT (LICENSE en repo, copyright "NEXO Inmobiliaria") | Bajo — MIT permite reventa; considerar cambiar copyright al vendedor real |
| Leaflet 1.9.4 | BSD-2-Clause | Bajo — compatible comercial, attribution presente en mapa |
| Tiles CARTO | CARTO free basemaps (requieren attribution; límites de uso razonable) | **Medio — requiere revisión humana**: para un producto revendido con tráfico de terceros, CARTO free puede no cubrir; alternativa: OSM estándar o tiles propios |
| OSM data | ODbL | Bajo con attribution (presente) |
| Fonts | System stack | Nulo |
| Icons | SVG propios inline | Bajo (asumiendo autoría propia — UNKNOWN) |
| Imágenes N-001 | Fotos de una propiedad real de tercero | **Medio — no son activo transferible; deben tratarse como demo y retirarse o licenciarse** |
| Workers AI (Gemma, BGE) | Términos Cloudflare + licencias de modelo (Gemma Terms of Use) | Medio-bajo — uso vía plataforma; el comprador necesita su propia cuenta Cloudflare |
| Cloudflare platform | ToS Cloudflare | Bajo — el comprador opera su propia cuenta |
| GitHub | ToS | Bajo |

**No se afirma "legalmente seguro":** la revisión de tiles CARTO para uso white-label revendido y la titularidad de las fotos de N-001 requieren revisión humana/legal.

## FASE 13Q — BUYER SIMULATION

### A. Developer
- LIKE: seguridad seria, tests 202, CI/CD real, código limpio sin frameworks, TAKEOVER.md honesto.
- HATE: god object worker.js; repo con recovery/ y repomix; docs drift.
- SCARE: currency drift (¿qué más no está en el repo?); deploys minutos antes de la demo.
- ASK: "¿Por qué prod ≠ repo? ¿Quién más tiene el ADMIN_TOKEN? ¿Por qué 1 propiedad?"
- FIX: reconciliar migrations, limpiar repo, tema white-label.
- BUY: como base técnica para un cliente, a precio de boilerplate.
- NOT BUY: si espera producto operable sin trabajo.

### B. Agency (inmobiliaria)
- LIKE: admin usable, CSV, WhatsApp CTA, guía legal cubana, fotos rápidas.
- HATE: no puede cambiar marca/WhatsApp sin llamar a un técnico; sin gestión de agentes.
- SCARE: depender de un desarrollador para todo lo de identidad; token único.
- ASK: "¿Puedo poner mi logo y mi número hoy?" (respuesta real: no sin código).
- FIX: nada por sí misma; necesita setup asistido.
- BUY: si se vende CON servicio de setup incluido.
- NOT BUY: si se vende como "self-service white-label".

### C. PropTech startup
- LIKE: auth real, authorization runtime, Vectorize+AI, PWA offline-first (diferencial para mercados con mala conectividad).
- HATE: sin multi-tenant, sin moderation workflow, sin roles de equipo.
- SCARE: deuda de producto para su caso de uso; schema drift señala proceso inmaduro.
- ASK: "¿Roadmap? ¿Multi-agencia? ¿API pública?"
- FIX: construir encima (es su modelo).
- BUY: como acelerador de 2–3 meses de trabajo de plataforma.
- NOT BUY: si el precio descuenta "producto terminado".

### D. Real estate operator (Cuba/LatAm)
- LIKE: funciona en 3G, offline, WhatsApp-first, español, guía legal local.
- HATE: 1 propiedad sin fotos demo adicionales; mapa vacío.
- SCARE: "¿quién lo mantiene cuando se rompa?"; dependencia Cloudflare (pagos desde Cuba difíciles).
- ASK: "¿Cuánto cuesta al mes operarlo? ¿Quién me sube las casas?"
- FIX: nada técnico; necesita operación asistida.
- BUY: solo con soporte continuado.
- NOT BUY: como activo DIY.

### E. Investor / non-technical
- LIKE: demo limpia, "tiene IA", PWA.
- HATE: nada que medir (sin tráfico, ingresos, usuarios).
- SCARE: todo — no puede operarlo ni evaluarlo solo.
- ASK: "¿Dónde están los números?" (no hay).
- BUY: no es el comprador adecuado sin socio técnico.
- NOT BUY: como inversión directa.


## FASE 13R — MARKET COMPARISON

### Cuba (evidencia web 2026-08-23)
| Player | Inventario | Notas |
|---|---|---|
| Revolico | Decenas de miles (clasificados generalistas) | El gigante de facto; UX antigua; sin verificación |
| BuscaTuChoza | **1,341 propiedades** | Moderno, mapa por barrios, publicación gratis, contacto directo, privacidad de dirección — **el competidor directo más cercano en concepto** |
| Casas Oasis | Cientos (73 solo en Plaza) | Se declara "portal líder"; multi-provincia |
| HogarEnCuba | ~295 | 12 años en web; promedios de precio por zona |
| CubanOSS | "miles de cubanos" (claim) | Publicación gratuita, guías legales |
| GAOS / El Caimán | UNKNOWN | No localizables como plataformas web (probablemente grupos FB/Telegram) |

**Comparación honesta:** NEXO como *sitio* pierde contra todos en lo único que importa a un usuario: inventario (1 vs 295–1,341+). Como *tecnología/UX*, NEXO está por encima de Revolico y a la par o por encima de BuscaTuChoza en ejecución visual, con mejor ingeniería (PWA offline, seguridad, IA). **Pero los portales ganan por inventario y network effect, no por tecnología.** NEXO no es un competidor de mercado; es un producto para que OTRO compita.

### Global (benchmark conceptual)
| Dimensión | NEXO vs Zillow/Redfin/Idealista/Realtor/Rightmove/Airbnb |
|---|---|
| TECHNOLOGY | Moderno y eficiente; comparable en stack edge; inferior en escala/datos |
| UX | 2–3 niveles por debajo (sin personalización, sin alertas, sin guardados avanzados) |
| UI | Limpio pero genérico; sin lenguaje visual propio memorable |
| FEATURES | Subconjunto mínimo (sin alertas, sin comparador de precios históricos, sin hipotecas, sin tours, sin reviews) |
| TRUST | Sin verificación real, sin reviews, sin páginas legales |
| SEO | Técnico correcto; sin contenido ni autoridad |
| MAP | Base Leaflet correcta; años luz de mapas con capas/datos |
| MOBILE | Buena base mobile-first; sin app |
| INVENTORY | 1 (demo) |
| BUSINESS MODEL | Ninguno implementado (sin monetización) |
| NETWORK EFFECT | Cero |

**NEXO no "gana" a nada global. No es su mercado.** Su valor es como plataforma white-label para mercados emergentes desatendidos.

## FASE 13S — FOR-SALE MARKET (comparables)

Evidencia recopilada (2026-08-23): no se encontraron ventas cerradas verificables de productos idénticos (portal inmobiliario white-label pre-revenue sobre edge). Lo que existe:

| Fuente | Dato | Tipo |
|---|---|---|
| Acquire.com (Seller FAQ) | Startups **pre-revenue solo se listan si son SaaS con asking < $25,000**; la mayoría se rechaza sin clientes de pago | ASKING FRAMEWORK |
| Flippa (categoría Real Estate / Directory) | Rangos de listado: $0–999, $1k–5k, $5k–15k, $15k–50k, $50k+; los directories pre-revenue pueblan los tramos bajos | ASKING RANGES |
| Flippa seller story | "Daniel vendió su real-estate SaaS por $300,000" — **con revenue** (no comparable a NEXO) | NO COMPARABLE |
| SideProjectors/Microns | Marketplaces de side projects; típicamente $500–$10k para código sin tracción | ASKING RANGES |
| Comisiones | Flippa 10% <$50k; Acquire 8% <$250k; listing fees $25–49 | COSTOS DE VENTA |

**Conclusión 13S:** para un activo de solo-código, pre-revenue, sin usuarios ni tráfico, el mercado observable son **asking prices de $500–$5,000** en Flippa/SideProjectors, con cierres reales típicamente por debajo del asking. **NO EVIDENCE de cierres verificables para este nicho exacto.** Un asking >$10k sin tracción no tiene soporte en comparables públicos.

## FASE 13T — VALUATION

Sin ingresos, usuarios, tráfico ni moat. N-001 no es tracción. Valor = costo de reproducción descontado por riesgo + prima por calidad de ingeniería.

| Componente | Valor atribuible | Base |
|---|---|---|
| CODE | $1,500–3,500 | ~3–5 semanas de trabajo senior reproducido (worker+frontend+auth+admin); descuento por P0 currency |
| DESIGN | $300–800 | Sistema de tokens serio pero ejecución genérica |
| ARCHITECTURE | $500–1,500 | Authorization runtime + sessions + audit son lo más difícil de reproducir |
| BRAND | ~$0 | Sin reconocimiento; el comprador la cambiará |
| DOMAIN | ~$0 | workers.dev del vendedor, no transferible como activo de marca |
| DATA | ~$0 | 1 propiedad demo + 1 cuenta test |
| TRACTION | $0 | Ninguna |
| DOCUMENTATION | $200–500 | TAKEOVER/README/extensa pero con drift |
| WHITE-LABEL CAPABILITY | $300–800 | Parcial (env vars); la promesa completa no se cumple |

| Escenario | Rango | Supuestos |
|---|---|---|
| 1. QUICK SALE | **$500–1,500** | Flippa/SideProjectors, as-is, sin soporte; descuento por P0 y rebrand manual |
| 2. FAIR MARKET | **$1,500–4,000** | Con P0/P1 arreglados, demo seed aplicado, 30 días de soporte de transición |
| 3. STRATEGIC BUYER | **$3,000–8,000** | Operador PropTech LatAm/Cuba que valora 2–3 meses de trabajo ahorrado + offline-first + auth completa; requiere vendedor con pipeline de venta activo |

Estos son **estimados anclados en asking ranges públicos (13S), no en ventas cerradas verificadas.**


## FASE 13U — FINAL SCORECARD

| Dimensión | Score 0–100 | Justificación anclada en evidencia |
|---|---|---|
| UX/UI | 60 | Sistema de diseño serio; tofu glyph, footer muerto, nav inconsistente, home vacía (13C) |
| Product | 50 | 1 propiedad demo, mapa vacío, sin recovery, sin páginas legales (13B/13C) |
| Functionality | 78 | Todo lo implementado funciona; faltan flujos (recovery, delete media, clustering) (13B) |
| Mobile | 70 | Mobile-first con safe areas/44px verificado en código; no verificado en dispositivo real |
| PWA | 72 | SW+manifest+offline sólidos; maskable ausente, theme inconsistente, fuga /api/me/ (13L) |
| Architecture | 74 | Modular donde importa; god object, dead schema, drift (13N) |
| Security | 84 | Mejor dimensión; 1 P2 SW-cache, 1 P1 rotación tokens entorno, resto mitigado (13J) |
| Performance | 85 | TTFB ~100ms, budgets CI, webp, 0 frameworks; field metrics UNKNOWN (13K) |
| SEO | 70 | SSR+JSON-LD+sitemap dinámico; URLs query-param, brand hardcoded (13M) |
| AI | 72 | Chat real con RAG+fallback+citas; sin streaming, modelo pequeño (13B) |
| Admin | 68 | CRUD+CSV+upload+reorder+geoclick; token único, sin users mgmt (13F) |
| White-label | 45 | 6/17 sin código; marca visible hardcodeada; manifest estático (13G) |
| Documentation | 70 | Extensa y honesta; drift en 4 puntos verificados (13A/13N) |
| Takeover | 50 | Guía existe; deploy fresco ROTO por currency (P0); secrets por rotar (13O) |
| Commercial Readiness | 32 | Sin demo seed aplicado, sin marca vendible, sin comparables de precio altos (13Q/13S) |

**GLOBAL SCORE (media ponderada):**
Pesos: UX/UI 10%, Product 10%, Functionality 8%, Mobile 5%, PWA 4%, Architecture 8%, Security 8%, Performance 6%, SEO 5%, AI 4%, Admin 6%, White-label 10%, Documentation 4%, Takeover 6%, Commercial Readiness 6%.

= 60(.10)+50(.10)+78(.08)+70(.05)+72(.04)+74(.08)+84(.08)+85(.06)+70(.05)+72(.04)+68(.06)+45(.10)+70(.04)+50(.06)+32(.06)
= 6.0+5.0+6.24+3.5+2.88+5.92+6.72+5.1+3.5+2.88+4.08+4.5+2.8+3.0+1.92
= **64.0 / 100**

(Media simple no ponderada: 65.3. La ponderación castiga más white-label y product, que son la tesis de venta.)

## FASE 13V — BRUTAL TRUTH

1. **¿Qué es NEXO realmente hoy?** Un MVP muy bien ingenieril de portal inmobiliario con una demo de 1 propiedad, empaquetado con documentación extensa. No es una plataforma white-label terminada; es una base técnica excelente a 1–2 semanas de pulido de serlo.
2. **¿Qué parte es excelente?** Seguridad (headers/CSP/sessions/authorization/audit), rendimiento (TTFB, budgets, media), y la honestidad de TAKEOVER.md. El runtime de autorización es trabajo de nivel senior real.
3. **¿Qué parte sigue siendo mediocre?** La capa visible de marca (hardcodeada), el mapa en la práctica (vacío), el footer (links muertos), y la higiene repo↔prod (currency).
4. **¿Mayor defecto visible?** Homepage con una sola card y un FAB con glifo roto "□ NEXO IA" — la primera impresión es "prototipo", no "producto".
5. **¿Mayor riesgo técnico?** El drift schema repo↔prod (currency): demuestra que hubo cambios a producción fuera del repo. Si hay uno, el comprador asumirá que puede haber más.
6. **¿Mayor riesgo comercial?** Venderlo como "white-label sin código" cuando cambiar la marca exige editar 7 archivos HTML: es una expectativa rota que destruye confianza en due diligence.
7. **¿Qué haría abandonar a un comprador?** Ejecutar el setup documentado y chocar con `no such column: currency` en las primeras 2 horas.
8. **¿Qué aumentaría el precio inmediatamente?** (a) arreglar el P0 y demostrar deploy fresco limpio en video; (b) aplicar el demo seed con 25 propiedades CON fotos de stock licenciadas y coordenadas; (c) hacer la marca 100% env-driven. Eso mueve el producto de "código" a "producto demostrable".
9. **¿Qué NO debemos construir?** Multi-tenant, moderation workflow, roles de equipo, app nativa, alertas, monetización, i18n. Nada de eso aumenta el precio de venta de un boilerplate; todo aumenta la superficie de mantenimiento.
10. **¿Comprarías NEXO tú mismo?** Como desarrollador que necesita lanzar un portal para un cliente en un mercado emergente: sí, me ahorra semanas reales. Como producto para operar mañana: no.
11. **¿A qué precio?** $1,500–2,500 as-is; hasta $4,000 con los P0/P1 cerrados y demo seed aplicado.
12. **¿Qué tendría que cambiar para pagar más?** Prueba de deploy fresco reproducible (video/test), marca 100% configurable, demo con 25 propiedades con fotos, y un caso de uso real (aunque sea piloto con 1 agencia y 50 inmuebles reales). Con eso: $6,000–8,000. Sin tracción real, nadie serio paga 5 cifras.


## FASE 13W — FINAL BACKLOG

### P0 — MUST FIX BEFORE SALE
| ID | Problema | Evidencia | Impacto | Riesgo | Esfuerzo | Valor comprador | Valor usuario | Recomendación |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Columna `currency` sin migration en repo; deploy fresco roto | 13A/13O: grep=0 en schema+migrations; PRAGMA prod la tiene; worker la usa | Deploy del comprador falla | Abandono en due diligence | S (1 migration + test) | CRÍTICO | Nulo | Crear `0007_properties_currency.sql` en repo, reconciliar d1_migrations, test de bootstrap fresco |
| P0-2 | Marca visible hardcodeada (43 literales, 7 HTML, manifest, wa.me text) | 13G | Promesa white-label falsa | Reputacional en venta | M (1–2 días) | CRÍTICO | Bajo | Hacer BRAND_NAME/LOGO/COLORS env-driven en todos los templates; manifest generado por worker |
| P0-3 | Demo sin contenido: 1 propiedad, seed no aplicado, seed sin fotos | 13B/13H | Demo no vende | Comprador no se convence | S–M | ALTO | Medio | Aplicar seed en entorno demo + añadir fotos de stock licenciadas al seed + banner en todas las páginas |

### P1 — SHOULD FIX BEFORE SALE
| ID | Problema | Evidencia | Impacto | Riesgo | Esfuerzo | Valor comprador | Valor usuario | Recomendación |
|---|---|---|---|---|---|---|---|---|
| P1-1 | Tokens del entorno del vendedor sin rotar (~/.cf_token, ~/.gh_token) | 13J | Takeover de cuentas | Seguridad del vendedor | S | ALTO | Nulo | Rotar antes de cualquier transferencia; documentar en handoff |
| P1-2 | SW cachea GET /api/me/favorites | 13J/13L | Fuga de datos de sesión en dispositivo compartido | Medio | XS (1 línea) | MEDIO | ALTO | Excluir /api/me/ en sw.js §1 |
| P1-3 | Footer con links muertos + sin páginas legales | 13C | "Producto sin terminar" | Conversión | S | MEDIO | ALTO | Páginas Sobre/Contacto/Privacidad/Términos (genéricas + env) o quitar links |
| P1-4 | Tofu glyph "□ NEXO IA" en FAB | 13C screenshot | Defecto amateur visible | Percepción | XS | MEDIO | MEDIO | Reemplazar emoji por SVG inline |
| P1-5 | Docs drift (0001–0005, /api/config.brand, 188 tests) | 13A | Setup falla o confunde | Takeover | S | ALTO | Nulo | Pasada de sincronización docs↔código + test anti-drift |
| P1-6 | Repo contiene recovery/ (996KB) y repomix (208KB) | 13N | Entrega poco profesional | Percepción | XS | MEDIO | Nulo | Sacar del repo (gitignore) antes de transferir |
| P1-7 | Navegación inconsistente entre páginas (4 variantes) | 13C | Sensación de producto pegado | Percepción | S | MEDIO | MEDIO | Unificar header component |

### P2 — NICE TO HAVE
| ID | Problema | Evidencia | Impacto | Esfuerzo | Recomendación |
|---|---|---|---|---|---|
| P2-1 | Mapa sin clustering ni fallback de tiles | 13D | Escala/robustez | M | leaflet.markercluster + tileerror→OSM |
| P2-2 | Admin token único sin 2FA/expiración | 13J/13F | Seguridad operativa | M | Documentar rotación; roles admin → post-venta |
| P2-3 | Sin recuperación de contraseña | 13E | Cuentas irrecuperables | M (requiere email provider) | Documentar limitación; Mailchannels/Resend como guía |
| P2-4 | theme-color meta ≠ manifest | 13C/13L | Polish PWA | XS | Unificar desde env |
| P2-5 | Uploads sin variantes WebP ni delete de imágenes | 13I | Costos R2 crecen | M | Generar variantes en upload (Workers Images) + delete en DELETE property |
| P2-6 | Enlace azul default rompe paleta | 13C | Polish | XS | Token --color-link coherente |
| P2-7 | URLs de propiedad con query param | 13M | SEO subóptimo | M | /propiedad/N-001-slug con redirect |
| P2-8 | Manifest estático | 13G | White-label PWA | S | Servir manifest desde worker con env |

### P3 — BACKLOG
| ID | Problema | Recomendación |
|---|---|---|
| P3-1 | Tablas muertas (analytics_*, ia_*, legacy favorites/users) | Migration de limpieza documentada |
| P3-2 | god object worker.js (1113 líneas) | Extraer módulos routes/ cuando crezca |
| P3-3 | security.txt ausente | Añadir archivo estático |
| P3-4 | PBKDF2 100k < ideal OWASP | Limitación de plataforma; reevaluar si Workers sube el techo |
| P3-5 | Rate limit fail-open | Documentar; considerar fail-closed para /api/admin/verify |
| P3-6 | Maskable icons PWA | Generar variantes maskable |
| P3-7 | JSON-LD Organization/WebSite en home | Añadir desde env brand |

### DO NOT BUILD
Multi-tenant/agencias · moderation workflow (04.8) · roles de equipo admin · app nativa · alertas de precio · monetización/pagos · i18n · verificación de email completa · analytics propio (ya hay tablas muertas de un intento) · reescritura a framework (React/Next) — destruiría el diferencial de peso/3G.

## FASE 13X — DEFINITION OF DONE ("NEXO SALE READY")

Checklist objetiva y verificable:

1. [ ] `git clone` limpio + `schema.sql` + `migrations apply` + `wrangler deploy` en cuenta Cloudflare NUEVA produce un sitio donde `GET /api/properties` devuelve 200 (no 500) y admin crea una propiedad sin error. Verificable con script de bootstrap en CI.
2. [ ] `grep -rn "NEXO" public/ worker.js` devuelve 0 literales visibles para el usuario (marca 100% desde env). Verificable con grep en CI.
3. [ ] Cambiar `BRAND_NAME`, `BRAND_LOGO`, `BRAND_THEME_COLOR`, `WHATSAPP_PHONE` en wrangler.toml + deploy cambia: header, footer, titles, manifest, wa.me text, OG, JSON-LD — sin editar código. Verificable con curl a /, /manifest.json, /api/config y property.
4. [ ] `DEMO_MODE=1` + seed aplicado muestra ≥20 propiedades con fotos y coordenadas, con banner visible en TODAS las páginas públicas; `--clear` las elimina sin tocar otras filas. Verificable con queries D1 y screenshots.
5. [ ] Producción limpia: 0 propiedades reales del vendedor, 0 cuentas de prueba, 0 sesiones (o proceso documentado de wipe). Verificable con SELECT COUNT.
6. [ ] Footer: todos los elementos son links funcionales o no existen. Verificable con click.
7. [ ] Mapa muestra ≥5 marcadores en demo y tiene comportamiento definido (fallback o mensaje) cuando los tiles fallan. Verificable bloqueando el dominio de tiles.
8. [ ] Secrets del vendedor rotados; handoff documenta lista completa. Verificable con checklist firmado.
9. [ ] Docs sin drift: TAKEOVER/DEPLOYMENT/AGENTS.md coinciden con código (test anti-drift en CI, como ya existe para CSP hashes).
10. [ ] Repo sin artefactos de proceso (recovery/, repomix, .audit). Verificable con ls.
11. [ ] /api/me/* excluido del SW cache. Verificable leyendo sw.js.
12. [ ] Tests ≥ actuales pasando en CI del comprador tras transferencia. Verificable con run verde en fork.

**Estado actual: 0/12 cumplidos al 100%.** (3 parciales: #5 es trivial, #9 existe el patrón, #12 es probable.)

---

## FINAL VERDICT

**VEREDICTO PRODUCTO: C — MVP READY**
Funciona como MVP de portal con inventario mínimo. No es market-ready (sin tracción, sin páginas legales, mapa vacío) ni product-ready-with-polish (el rebrand exige código y el deploy fresco está roto).

**VEREDICTO VENTA: 🔴 NOT READY**
No por la calidad del código — que es alta — sino por tres bloqueantes de evidencia primaria: (1) deploy fresco roto por drift de schema (P0-1); (2) promesa white-label no cumplida en lo visible (P0-2); (3) demo sin contenido que convenza (P0-3). Los tres son cerrables en **1–2 semanas de trabajo enfocado**, tras lo cual el veredicto pasa a 🟡 SALE READY WITH CONDITIONS (condiciones: revisión legal de tiles/fotos, rotación de secrets, soporte de transición).

**VEREDICTO DESARROLLO: SMALL POLISH ONLY**
Cerrar P0+P1 y detener el desarrollo de features. Cada feature nueva (multi-tenant, moderation, roles) aumenta el mantenimiento sin aumentar el precio de venta de un boilerplate pre-revenue.

**GLOBAL SCORE: 64/100.**
Ingeniería: A−. Producto visible: C−. Vendibilidad white-label hoy: D+. El gap entre lo que la documentación anterior afirmaba ("SALE READY") y lo que la evidencia primaria muestra es exactamente el gap entre un buen codebase y un buen producto.

---

*Fin del reporte. Auditoría ejecutada en modo READ-ONLY: sin modificaciones de código, sin commits, sin push, sin deploys, sin escrituras intencionales en D1/R2/Vectorize, sin migraciones, sin cambios de secrets ni de configuración Cloudflare. Efecto lateral inevitable y mínimo: incrementos del contador de rate_limits en D1 por las peticiones de prueba (GET /api/session/status, POST /api/chat ×1, POST /api/auth/register con body vacío rechazado en validación sin tocar DB).*

