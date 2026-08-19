# NEXO — Master Product Audit (Fase 0)

Fecha: 2026-08-19 · Repo: `nexo-inmobiliaria` @ `6db102c` · Baseline: **15/15 tests verdes**, home TTFB 190ms / 74KB, API TTFB ~275ms (edge cache).

## Estado actual confirmado (hechos del repo, no suposiciones)

- Worker monolítico (~78KB): router plano, D1 prepared statements, caché de borde 60s, Cache API en GETs públicos, JWT HS256 + cookie de sesión, OG edge-rendering en `/propiedad/<id>`, proxy de imágenes con `cf.image`.
- Frontend: 6 páginas HTML con JS inline (index 74KB, mapa 53KB, ia 43KB, admin 50KB), tokens en `variables.css`, mapa doble motor (MapLibre+OpenFreeMap / Leaflet+CartoDB), PWA con SW.
- Datos reales en producción: **5 propiedades**; 3 sin título, descripciones basura ("Ok", "Sss"), 2/5 sin coordenadas, 1/5 verificada, 1/5 con 64 fotos reales.
- PII: API pública limpia (sin `owner_phone`, `contact_email`, `notes`, `address`) ✓.
- Vectorize `nexo-index` existe pero **vacío** (sync no ejecutada en producción).

## Matriz de estado

| ID | AREA | CURRENT STATE | PROBLEM | IMPACT | PRIORITY | PROPOSED SOLUTION | FILES | RISKS | ACCEPTANCE CRITERIA |
|----|------|---------------|---------|--------|----------|-------------------|-------|-------|---------------------|
| A-01 | Datos/Trust | 5 props, 60% sin título, descripciones basura, coords ausentes | La UI presenta datos pobres como creíbles; mina la confianza | Alto (conversión/marca) | **P0** | Quality Score calculado de campos reales (fotos>0, coords, desc>40c, título) + badge honesto en UI + gates de validación en admin | worker.js, admin.html, index.html | Romper flujos admin existentes | Ninguna card muestra basura ("Ok"); score visible en admin; badge "Datos incompletos" cuando aplica |
| A-02 | SEO/Growth | OG en `/propiedad/<id>` ✓; falta JSON-LD, sitemap.xml, robots personalizado | Crawlers sin grafo de contenido; snippets pobres | Medio-alto | **P0** | `application/ld+json` (RealEstateListing) en el edge-render + `/sitemap.xml` dinámico desde D1 + robots.txt propio | worker.js | Bajo | sitemap.xml 200 con URLs reales; validator.schema.org sin errores en detalle |
| A-03 | Observabilidad | Solo `console.error/warn` | Cero visibilidad de errores/latencia en producción | Medio | **P0** | Log estructurado JSON (ruta, método, status, ms) en catch global y endpoints clave; métricas nativas de Workers | worker.js | Ruido en logs | Cada 5xx produce 1 línea JSON parseable con duración |
| A-04 | Mapa | Marcadores apilados en coords idénticas (ids 7/8) | Solo 1 píldora visible/clicable; list↔map no bidireccional en home | Alto (descubrimiento) | **P0** | Spiderfy/offset determinista por id + al hacer clic en card, `flyTo` suave al marcador (sync unidireccional mínima) | index.html | Confusión en puntos casi iguales | Las 3 píldoras de La Lisa son distinguibles y clicables |
| A-05 | IA | Chat funciona con LLM libre; semantic search + sync implementados pero índice vacío y sin integración UI | IA responde texto, no ejecuta acciones; semantic search sin poblar | Medio-alto | **P1** | Ejecutar sync (admin) + acciones estructuradas simples en respuesta IA (`{action:"filter"|"compare"|"map", params}` parseada del LLM) | worker.js, public/ia/index.html | LLM devuelve JSON inválido → fallback a texto | Preguntar "casas con agua 24/7" filtra el inventario real |
| A-06 | Property Page | Galería estática, sin similares, CTA no sticky en mobile | Fricción en el punto de conversión | Alto | **P1** | Similares reales (misma ciudad ±30% precio, D1), swipe en galería, CTA sticky bottom con safe-area | property.html, worker.js | Queries extra lentas | Detalle muestra ≥1 similar real; CTA visible siempre en 390px |
| A-07 | Accesibilidad | 10 atributos ARIA en index; chips de filtro <44px; focus trap del modal sin verificar | Fallos WCAG AA probables | Medio-alto | **P1** | Auditoría focalizada: targets ≥44px, focus visible, aria-modal+trap en modal/drawer IA, prefers-reduced-motion ya parcial | index.html, mapa/index.html | Regresión visual | axe-core: 0 violaciones críticas en home |
| A-08 | Seguridad | CSP con `unsafe-inline` (necesario por JS inline); JWT secret fallback a ADMIN_PASSWORD; rate-limit solo en login | Superficie de abuso ampliada; secreto compartido | Medio | **P1** | `wrangler secret put JWT_SECRET` (operación, no código) + rate-limit en endpoints IA (coste AI) + documentar plan para externalizar JS | worker.js, wrangler.toml | Rotación de secretos | /api/ia responde 429 tras N req/min por IP |
| A-09 | Performance | Imágenes por proxy WebP ✓, caché 60s ✓, JS inline ~40-74KB/página | Main thread pesado en gama baja; sin métricas RUM | Medio | **P1** | Medir con Lighthouse CI (mobile, 4G): defer de init de mapa hasta visibilidad (ya parcial), lazy de IA | index.html | — | LCP < 2.5s en 4G simulado en home |
| A-10 | Testing | 15 tests de Worker; 0 E2E | Flujos críticos sin cobertura (search→map→property→contact) | Medio | **P2** | Tests node:test para semantic/JWT/images + smoke E2E curl de flujos clave en CI manual | test/ | Falsos positivos | 25+ tests; flujo contacto cubierto |
| A-11 | Analytics | Inexistente | Decisiones de producto a ciegas | Medio | **P2** | Telemetría anónima: contadores agregados en D1 (búsquedas sin resultados, clics WhatsApp) — sin PII, sin cookies | worker.js, index.html | Privacidad | 1 endpoint /api/metrics (admin) muestra conteos del día |
| A-12 | Admin móvil | 50KB página, no verificada en 390px | CMS inusable desde iPhone (mercado objetivo) | Medio | **P2** | Smoke test visual en 390px + ajustes puntuales | admin.html | — | Crear/editar propiedad completable en 390px |
| A-13 | IA contexto | Respuestas buenas pero sin awareness de página/propiedad actual | "algo parecido pero más barato" no funciona | Medio | **P2** | Pasar contexto de propiedad actual al prompt cuando el widget se abre desde detalle/contacto | index.html, worker.js | Prompt injection desde títulos | En detalle, "más barato" devuelve opciones reales menores al precio |

## Baseline de rendimiento (medido 2026-08-19)

- Home: TTFB 190ms, 74KB HTML, imágenes WebP proxied, fonts de sistema.
- API properties: ~275ms con HIT de caché de borde.
- Riesgos de main thread: JS inline grande + mapa (inicializa al cargar, no al hacer scroll).

## Privacidad (verificado)

- API pública NO expone: `owner_name`, `owner_phone`, `contact_email`, `notes`, `address`.
- Contacto se canaliza por NEXO IA / wa.me genérico sin número — decisión deliberada, se mantiene.
