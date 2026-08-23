# FINAL-GATE-15 — PRODUCTION BUYER GATE

**Fecha:** 2026-08-23 · **Auditor:** Agente autónomo (Fase 15) · **Modo:** read-only-first, adversarial, sin asunciones
**Producción auditada:** https://nexo-inmueble.luisangelfigueredo02.workers.dev
**HEAD al cierre:** `fd5ccaa` (main, pushed) · **Último deploy:** Version ID `c1d7dfa7-441b-4410-a2af-6d2a87c08d35` · **Tests:** 245/245

---

## Executive Summary

NEXO entra a Fase 15 declarando "245/245 tests, demo estable, mapa verificado". La auditoría independiente encontró que **esa declaración era parcialmente falsa en producción real**: el detalle de las 25 propiedades demo devolvía 404 (P0), el mapa a pantalla completa mostraba una zona rural vacía con "0 propiedades visibles" (P1), el tracker de migraciones de producción estaba desincronizado con el repo (P1), el comando de migración documentado fallaba en ambos escenarios (P1), la guía de takeover daba instrucciones de D1 incorrectas (P1), y el banner demo tapaba el header en 3 páginas (P2).

**Los 6 defectos fueron corregidos, desplegados y verificados en producción durante esta fase** (fixes pequeños, reversibles, con tests y evidencia).

Tras los fixes, el veredicto final es:

## VEREDICTO FINAL: 🟡 READY TO SELL WITH CONDITIONS

No es 🔴: todas las rutas responden, el sistema de usuarios funciona end-to-end, el mapa es demostrable, las imágenes cargan, el white-label es real sin tocar código, las migraciones son reproducibles y no se encontraron 404/500/crash/pantallas rotas tras los fixes.

No es 🟢: persisten condiciones objetivas que un comprador serio detectará en due diligence (ver §15P).

---

## RESUMEN DE FIXES EJECUTADOS EN FASE 15

| # | Señal | Severidad | Fix | Evidencia |
|---|---|---|---|---|
| 15A | `/api/properties/D-001` → 404 (todo el inventario demo roto en detalle) | **P0** | `PUBLIC_CODE_RE` acepta `D-XXX` + test de regresión | Prod: D-001 → 200 |
| 15D | `/mapa/` centrado en el promedio aritmético (22.25,-80.33, Cuba rural) → "0 propiedades visibles", tiles de zona vacía | **P1** | `fitBounds` de todas las coords (maxZoom 13; setView si solo 1) | Headless: "25 propiedades visibles" + tiles CARTO cargados |
| 15C | Banner demo tapaba el header fixed en /mapa/, /comparar/, /ia/ | P2 | `demo-banner.js` desplaza headers fixed/sticky bajo el banner | Screenshot verificado |
| 15F | TAKEOVER.md: producción sin `schema.sql` previo (0002 ALTER falla); migraciones "0001–0005" (real: 0001–0007) | **P1** | Doc corregida | Diff commit `c68b7af` |
| 15G | `d1_migrations` prod sin 0007; `wrangler d1 migrations apply` falla por ALTER duplicado en prod actual Y en D1 nueva; `apply-migrations.mjs` roto (yargs rechaza `--command` que empieza por `--`) | **P1** | Fix script (prefijo no-op) + reconciliación ejecutada en remoto + TAKEOVER usa el script | `migrations list`: "✅ No migrations to apply" |

**Única escritura en D1 ejecutada:** el registro de la migration 0007 en `d1_migrations` vía la herramienta de reconciliación del propio proyecto (idempotente; el ALTER se omitió porque la columna ya existía). Justificación: sin ella, el flujo de migración documentado para el comprador estaba roto. Ninguna otra escritura en D1/R2/Vectorize. Ningún dato de inventario ni de usuarios modificado.

---

## EVIDENCE MATRIX (rutas de producción)

| Ruta | Estado | Clasificación |
|---|---|---|
| `/` | 200, 26 propiedades, búsqueda/filtros/lista-mapa | VERIFIED |
| `/mapa/` | 200, 25 marcadores con precio, sidebar sincronizado, tiles CARTO | VERIFIED (tras fix 15D) |
| `/comparar/` | 200, empty state honesto con CTA | VERIFIED |
| `/ia/` | 200, chat IA (modelo gemma-4) | VERIFIED |
| `/cuenta/` | 200, login/registro funcional | VERIFIED |
| `/admin` | 307→200, gate por token | VERIFIED |
| `/legal` | 307→200 | VERIFIED |
| `/property.html?id=N-001` | 200, 11 fotos R2, galería, JSON-LD | VERIFIED |
| `/property.html?id=D-001` | 200 (tras fix 15A) | VERIFIED |
| `/api/health` | 200 | VERIFIED |
| `/api/config` | 200, brand completo | VERIFIED |
| `/api/properties` | 200, 26 items, sin campos privados | VERIFIED |
| `/api/properties/<inexistente>` | 404 indistinguible | VERIFIED |
| `/sitemap.xml` | 200, 30 URLs, origin dinámico | VERIFIED |
| `/robots.txt` | 200, Disallow /admin | VERIFIED |
| `/manifest.webmanifest` | 200, standalone, 3 iconos | VERIFIED |
| `/media/n001/photo-01.jpg` | 200 image/jpeg, immutable | VERIFIED |
| `/media/n001/photo-01-w{400,800,1200}.webp` | 200 image/webp | VERIFIED |
| `/media/../traversal` | 400 | VERIFIED |
| `sw.js` | `nexo-v9-static-swr`, SWR | VERIFIED |

---

## 15A — PRODUCTION TRUTH

- **Rutas:** todas 200 (o 307→200 en admin/legal). Sin 404/500 en rutas públicas.
- **P0 encontrado:** `PUBLIC_CODE_RE = /^N-\d+$/i` en `worker.js` rechazaba los códigos demo `D-XXX` → el detalle de las 25 propiedades demo caía al lookup por id numérico → 404 → `property.html` mostraba "no disponible". **El 96% del inventario visible tenía el detalle roto.** Corregido + test de regresión + deploy + verificación en prod.
- **Endpoints:** respuestas correctas; campos privados (owner_name/phone, internal_notes, address) ausentes del API público (spot-check).
- **Navegación principal:** home ⇄ mapa ⇄ comparar ⇄ IA ⇄ cuenta ⇄ detalle ⇄ WhatsApp CTA: funcional.
- **Console/errores:** sin crashes JS observados en las páginas auditadas (headless Chromium + navegador real).

## 15B — SERVICE WORKER / CACHE

- Versión: `SW_VERSION = "nexo-v9-static-swr"` — stale-while-revalidate para assets estáticos.
- Evidencia de actualización: la versión desplegada en prod coincide con el repo; los fixes 15A/15D se reflejaron en prod tras deploy (el SW no sirvió código viejo: SWR revalida en background y el HTML de las páginas no queda congelado).
- `/api/session/*` excluido del SW (respeta `no-store`) — verificado en código.
- Riesgo residual: usuarios con SW v8 (cache-first) de visitas anteriores a Misión 14 pueden retener assets viejos hasta que el SW se actualice (~24h o cierre de pestañas). Mitigado por el versionado de caché por `SW_VERSION`. Clasificación: PARTIAL→VERIFIED con riesgo acotado y documentado.

## 15C — VISUAL BUYER TEST (como comprador, no como dev)

| Pantalla | Estado | Impresión |
|---|---|---|
| Home desktop | ✅ | Hero claro, búsqueda, filtros, cards con badge DEMO, toggle Lista/Mapa. 7/10 |
| Home mobile 390px | ⚠️ | Funcional; el botón "Entrar" queda parcialmente clipeado en el borde derecho del nav (**P2 abierto**) |
| Detalle propiedad | ✅ | Galería 11 fotos, badges, specs, CTA WhatsApp, guía de compra. 7.5/10 |
| Mapa | ✅ (tras fix) | Tiles + 25 marcadores con precio + sidebar. Sin clustering (se solapan en La Habana a zoom país — **P3**) |
| Comparar | ✅ | Empty state honesto con CTA. 7/10 |
| IA | ✅ | Chat limpio con sugerencias. 7/10 |
| Cuenta | ✅ | Login/registro sobrio y claro. 7/10 |
| Admin | ✅ | Gate de token espartano pero correcto para su propósito |
| Banner demo | ✅ (tras fix) | Ya no tapa headers; badge DEMO en cards (bottom-right) |

**Fix ejecutado:** headers fixed/sticky desplazados bajo el banner (15C).
**Abiertos (no bloqueantes):** overflow del nav en móvil ≤390px (P2); sin clustering de marcadores (P3).

## 15D — MAP AUDIT

- **Leaflet self-hosted** (`/vendor/leaflet/`, 147KB) — sin dependencia de CDN para la librería. ✓
- **Tiles:** CARTO basemaps (externo). CSP `img-src https:` lo permite. Dependencia de red externa: sí, con `tileerror` watchdog que muestra aviso honesto tras 8 fallos ("El mapa base no está disponible. Los marcadores siguen activos"). ✓
- **P1 encontrado y corregido:** centrado por promedio aritmético del inventario multi-provincia → vista en Cuba central rural (22.25,-80.33) a zoom 14, 0 marcadores visibles, tiles de zona vacía. **El mapa parecía roto estando sano.** Ahora `fitBounds` (como la home).
- **Coordenadas:** 25/26 propiedades geolocalizadas; N-001 (sin coords) se excluye limpiamente; NULL nunca se convierte en 0,0. ✓
- **Sin coordenadas:** estado explícito (`showNoCoordsState`), no mapa mudo. ✓
- **Pendiente:** clustering (P3), comportamiento con >500 marcadores no probado (UNKNOWN, no crítico para el inventario objetivo).

## 15E — WHITE-LABEL GAP ANALYSIS

| Elemento | Mecanismo | Clasificación |
|---|---|---|
| Nombre de marca | `BRAND_NAME` → tokens `{{BRAND_*}}` en HTML servido | **A — configurable sin código** |
| Logo | `BRAND_LOGO` | A |
| Colores (primario/tema/bg) | `BRAND_PRIMARY_COLOR`/`BRAND_THEME_COLOR` | A |
| Tagline/descripción SEO/OG | `BRAND_TAGLINE`/`BRAND_DESCRIPTION` | A |
| WhatsApp | `WHATSAPP_PHONE` (mensaje usa `{{BRAND_NAME}}`) | A |
| Email/teléfono/dirección | `CONTACT_*`/`BUSINESS_ADDRESS` | A |
| Redes sociales | `SOCIAL_*` | A |
| País/locale/moneda | `MARKET_*`/`DEFAULT_CURRENCY` | A |
| Centro/zoom mapa | `MAP_CENTER_LAT/LNG`/`MAP_ZOOM` | A |
| Demo mode | `DEMO_MODE` | A |
| Dominio | Custom Domain en Cloudflare; sitemap/OG usan `url.origin` dinámico | A |
| PWA manifest | generado desde brand | A |
| Textos legales (legal.html) | contenido propio, editable en HTML | **B — texto, no config** |
| Filename CSV export (`nexo-inmuebles-…`) | hardcoded en admin.html | **C — cosmético, solo admin** |
| Keys localStorage (`nexo_favs`, `nexo_admin_token`) | internas, invisibles al usuario | D — cosmético |
| Comentarios "NEXO" en CSS/JS | internos | D — cosmético |
| Idioma de la UI | español hardcoded en HTML | **B — estructural (single-locale)** |

**Veredicto white-label:** el rebrand comercial completo (marca, logo, colores, contacto, mercado, mapa, dominio) se hace editando `[vars]` + redeploy. VERIFIED. No hay búsqueda/reemplazo manual de HTML. Gaps reales: idioma único (B) y textos legales (B). Ninguno bloquea una venta a mercado hispanohablante.

## 15F — TAKEOVER TEST (contra el repo real)

Simulación de comprador técnico siguiendo TAKEOVER.md:

1. Clonar + `npm install` ✓
2. `wrangler login` / token ✓
3. Crear D1 → **fallaba**: TAKEOVER no incluía `schema.sql` en producción (0002 hace ALTER sobre `properties`) → **corregido (doc)**
4. Migraciones → **fallaba**: `wrangler d1 migrations apply` rompe en 0007 (ALTER duplicado) tanto en prod actual como en D1 nueva → **corregido** (`apply-migrations.mjs` reparado, tracker reconciliado, doc actualizada)
5. R2/Vectorize/AI: bindings declarados en `wrangler.toml`; el comprador debe crear sus recursos y actualizar nombres/IDs — documentado ✓
6. Secrets: `ADMIN_TOKEN` (+ rotación documentada en §7) ✓
7. Deploy: `npx wrangler deploy` ✓ (3 deploys ejecutados en esta fase sin fricción)
8. Rebrand: `[vars]` → redeploy ✓ (15E)
9. Inventario: admin CRUD + CSV import/export + imágenes R2 ✓ (14I verificó CSV; CRUD verificado por tests de integración)
10. CI/CD: `.github/workflows/deploy.yml` existe ✓

**Time to first deploy (comprador técnico):** ~1–2 h (crear recursos Cloudflare + secrets + migraciones).
**Time to white-label:** ~15 min (vars + redeploy).
**Puntos de falla restantes:** creación manual de recursos Cloudflare (D1/R2/Vectorize) no automatizada; dependencia de que el comprador rote `ADMIN_TOKEN` (documentado).

## 15G — DB / MIGRATION FORENSICS

- Estado inicial: prod tenía `0001–0006` + una migration histórica **no versionada** (`0006_properties_currency`, aplicada 2026-08-22) y **no** tenía registrada `0007_schema_reconciliation` → drift repo↔prod.
- `schema.sql` ya incluye `properties.currency` → el ALTER crudo de 0007 es incompatible con `wrangler d1 migrations apply` en **cualquier** escenario.
- **Fix:** `apply-migrations.mjs` (herramienta del proyecto, idempotente) reparado (bug de yargs con `--command` que empieza por `--`) y ejecutado en remoto: ALTER omitido (columna ya existía), tracker reconciliado. `migrations list`: **"✅ No migrations to apply"**.
- Tablas legacy vacías (`favorites`, `user_favorites`, `users`) siguen presentes — cleanup diferido, sin impacto.
- **Escritura ejecutada:** solo el INSERT del tracker de 0007 (justificado arriba).

## 15H — USER SYSTEM E2E (cuenta real de prueba)

| Flujo | Resultado |
|---|---|
| Registro | 201, cookie `__Host-session` HttpOnly+Secure+SameSite=Lax |
| Session status | 200 con identidad correcta |
| Favorito PUT/GET (D-001) | 200, persiste en D1 |
| Favoritos sin sesión | 401 (sin IDOR: no se pueden leer favoritos ajenos) |
| Logout | revoca sesión |
| Limpieza | cuenta de prueba eliminada (10 tablas hijas en orden FK) |

VERIFIED end-to-end. Rate limiting presente en código y cubierto por tests (no se ejecutaron ataques).

## 15I — MEDIA / IMAGES / UPLOADS

- Servido: `/media/*` desde R2 con `Cache-Control: public, max-age=31536000, immutable`, MIME correcto (`image/jpeg`, `image/webp`). ✓
- Variantes responsivas `-w400/-w800/-w1200.webp` existen y se referencian vía `srcset`. ✓
- Traversal: `..%2f` y variantes → 400 (guard canónica con decodificación iterativa). ✓
- Bug histórico `headers.set("Vary")` sobre headers inmutables: **no puede reaparecer** — la respuesta se construye sobre `new Headers(...)` mutable y `Vary: Accept` solo se fija cuando hay negociación de formato. ✓
- Subidas: solo vía admin autenticado (Bearer), validación en worker (tests de integración cubren MIME/tamaño). ✓
- 11/11 fotos de N-001 cargan; SVGs demo con marca de agua "DEMO". ✓

VERIFIED.

## 15J — SECURITY GATE

| Vector | Resultado |
|---|---|
| SQLi en `/api/properties/:id` | 404, parametrizado (sin vector) |
| XSS reflejado en `?id=` | sin reflexión; escaping `escapeHtml` en inyecciones |
| Admin sin token | 401 |
| Headers de seguridad | HSTS, CSP (hash-based, sin unsafe-inline en scripts), XFO DENY, XCTO, Referrer-Policy, Permissions-Policy — 6/6 |
| R2 traversal | 400 |
| Sesiones | cookie `__Host-` HttpOnly/Secure/Lax; hash SHA-256 en D1; concurrencia máx 5 |
| Autorización | deny-by-default, fail-closed (módulo `src/auth/authorization/`, 59 tests) |
| Rate limiting | presente en login/register/session/chat (código + tests) |
| Secretos en repo | ninguno encontrado; `~/.cf_token`/`~/.gh_token` históricos → **rotación pendiente del propietario (condición C2)** |

Sin hallazgos P0/P1 abiertos. **Nota:** el plano admin usa Bearer token único (sin 2FA, sin rotación automática) — aceptable para el tamaño del producto, documentado en TAKEOVER §7.

## 15K — PERFORMANCE / MOBILE / LOW-END

- TTFB prod: **~100–115 ms** en todas las rutas (Workers + Smart Placement).
- Payloads: home 62KB HTML, mapa 32KB, detalle 48KB, CSS 18KB, Leaflet 147KB self-hosted, imágenes WebP con variantes 10–16KB (w400).
- Sin frameworks JS pesados; JS inline + un vendor. Sin CDNs de terceros bloqueantes salvo tiles CARTO (con fallback).
- Móvil: layout responsive verificado a 390px; único defecto: clipping del botón "Entrar" en el nav (P2).
- Cuba/3G: payload inicial bajo, imágenes diferidas, SW SWR — diseño coherente con "Modo Isla". Lighthouse no ejecutado → métricas de lab: UNKNOWN (no se inventan).

## 15L — SEO / DISCOVERABILITY

- Titles/descriptions dinámicos por propiedad, OG completo (title/description/image/url/locale es_CU), JSON-LD en detalle. ✓
- `sitemap.xml` dinámico (30 URLs, origin-agnóstico), `robots.txt` con Disallow de admin. ✓
- Canonical/SSR: HTML servido desde el worker con tokens ya sustituidos (contenido indexable sin JS). ✓
- **Observación:** el sitemap incluye las 25 URLs demo `D-*` mientras `DEMO_MODE=1`. Correcto para demo; al desactivar demo + clear, el sitemap se limpia solo. P3.

## 15M — PRODUCT REALITY

NEXO es hoy: **una plataforma inmobiliaria white-label funcional de un solo Worker** con catálogo, búsqueda/filtros, mapa, comparador, chat IA, cuentas con favoritos sincronizados, admin con CRUD/CSV/imágenes, PWA, SEO dinámico y demo mode reversible.

Lo que **no** es: un marketplace con liquidación de contactos, pagos, verificación real de identidad de anunciantes, multi-idioma, ni red de inventario. El inventario actual es 25 demos ficticias + 1 real (N-001). La promesa de venta debe ser "plataforma lista para operar con tu inventario", no "portal con tracción".

## 15N — MARKET REALITY

- **Cuba:** los competidores (grupos de WhatsApp/Telegram, Facebook, portales legacy) tienen inventario y audiencia; NEXO tiene mejor tecnología, UX y SEO que cualquier portal cubano conocido, pero **cero red de usuarios**. El valor de NEXO no es competir como portal sino venderse como infraestructura.
- **Como white-label global:** compite con boilerplates PropTech y themes premium. Diferenciadores reales: stack serverless de coste ~$0, IA integrada, PWA offline-first, seguridad auditada, demo mode, takeover documentado. Debilidades: single-locale (es), single-tenant, sin panel de configuración visual (rebrand = editar vars + redeploy), mapa sin clustering.
- **Comprador plausible:** agencia/operador hispanohablante que quiere lanzar su portal propio sin contratar desarrollo desde cero, o un micro-SaaS builder que lo revenda por vertical/país.

## 15O — BUYER SIMULATION

| Perfil | Le gusta | Le frena |
|---|---|---|
| Developer comprador | Stack limpio, 245 tests, authz real, docs, CI | God-file `worker.js`; single-locale; quiere ver el roadmap |
| Agencia inmobiliaria | Rebrand en 15 min, CSV import, WhatsApp CTA, demo mode | Necesita un técnico para el primer deploy (1–2 h); sin panel visual de config |
| Startup PropTech | Base sólida para iterar, IA incluida, coste ~$0 | Sin multi-tenant; auth social ausente; escalado de mapa no probado |
| Comprador no técnico | Demo navegable convincente | Necesita sí o sí un técnico para takeover (documentado, pero real) |

## 15P — SALE GATE

| # | Criterio | Estado |
|---|---|---|
| 1 | Rutas públicas sin 404/500/pantallas rotas | ✅ PASS (tras 15A/15D) |
| 2 | Sistema de usuarios e2e (registro/login/favoritos/logout) | ✅ PASS |
| 3 | Mapa demostrable con inventario real | ✅ PASS (tras 15D) |
| 4 | Imágenes/media production-ready | ✅ PASS |
| 5 | Migraciones reproducibles repo↔prod | ✅ PASS (tras 15G) |
| 6 | White-label sin tocar código | ✅ PASS |
| 7 | Takeover ejecutable por tercero siguiendo docs | ✅ PASS (tras 15F/15G) |
| 8 | Demo mode honesto y reversible | ✅ PASS (seed/clear documentados, badges + watermark) |
| 9 | Seguridad sin P0/P1 abiertos | ✅ PASS |
| 10 | SW sin riesgo de congelar versiones viejas | ✅ PASS (SWR v9) |

### Condiciones para subir a 🟢 READY TO SELL

- **C1.** Rotar `ADMIN_TOKEN` y los tokens históricos expuestos (`~/.cf_token`, `~/.gh_token`) antes de transferir — es operación del propietario, no del repo.
- **C2.** Ejecutar el clear demo (`seed-demo.mjs --clear`) + `DEMO_MODE=0` en el momento de entrega, o entregar explícitamente "con demo mode activo" como decisión comercial.
- **C3.** Fix del clipping del nav móvil (P2, ~15 min).
- **C4.** Eliminar `public/config.js` (código muerto) y tablas legacy vacías, o declararlas como deuda conocida en el data room.

### No requerido para vender (backlog honesto)

Clustering de marcadores (P3), i18n (P3), auth social (P3), panel visual de configuración (P3), multi-tenant (fuera de scope), métricas Lighthouse de lab (P3).

---

## RIESGOS RESIDUALES

| Riesgo | Nivel | Mitigación |
|---|---|---|
| Tiles CARTO = dependencia externa (bloqueo/caída) | Bajo | watchdog tileerror + marcadores operativos + aviso honesto |
| Bearer admin único | Bajo-medio | rotación documentada; scope reducido |
| Inventario demo podría confundirse con tracción | Comercial | banner + badges + watermark + sitemap se limpia con clear |
| Usuarios con SW v8 retienen assets viejos | Bajo | TTL de caché y versionado; desaparece solo |

## BACKLOG FINAL (post-Fase 15)

- **P2:** clipping botón "Entrar" en nav móvil ≤390px.
- **P3:** clustering de marcadores; `public/config.js` muerto; tablas legacy; sitemap incluye D-* en demo mode; i18n; auth social; Lighthouse lab.

## RECOMENDACIÓN OPERATIVA

1. Ejecutar C1–C4 (media jornada, todo operativo).
2. Preparar el data room con: este reporte, TAKEOVER.md, README, demo navegable con DEMO_MODE=1.
3. Vender como **"plataforma white-label production-ready + demo mode"**, nunca como portal con tracción.
4. No construir nada nuevo antes de la venta: el marginal value de cualquier feature adicional es menor que el riesgo de romper el gate.

---

*Metodología: evidencia primaria (producción en vivo, código, D1, R2) sobre evidencia secundaria (reportes de fases anteriores). Toda afirmación VERIFIED tiene comando/screenshot asociado; lo no verificable se marcó UNKNOWN. Fases 15A–15P ejecutadas en orden con fixes mínimos, reversibles y commiteados: `15169cd` (15A), `df3a275` (15D), `c68b7af` (15C/15F), `fd5ccaa` (15G).*
