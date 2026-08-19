# NEXO — Roadmap P0→P3 (post Fase 0)

Ordenado por: seguridad/estabilidad → impacto de usuario → performance → growth.
Cada lote sigue el ciclo AUDIT → PLAN → IMPLEMENT → TEST → MEASURE → REVIEW → FIX → VERIFY, con commit propio.

## P0 — Estabilidad, confianza y fundamentos (1-2 sesiones)

1. **A-04 Marcadores apilados en el mapa** (rápido, visible): offset determinista por id cuando dos propiedades comparten coords; click en card → flyTo.
2. **A-01 Trust & Data Quality**: Quality Score derivado SOLO de campos reales (fotos, coords, título, descripción>40c, contacto, actualización). UI: no renderizar títulos/descripciones vacíos como si fueran datos; badge "Datos incompletos" honesto. Admin: validación al guardar + score visible.
3. **A-02 SEO estructural**: JSON-LD `RealEstateListing` en `/propiedad/<id>`, `/sitemap.xml` dinámico (solo props reales), robots.txt propio.
4. **A-03 Observabilidad mínima**: logs JSON estructurados (ruta/status/ms) en errores y endpoints clave.
5. **A-08a Seguridad operativa**: rate-limit por IP en `/api/ia` y `/api/search/semantic` (coste AI), documentar `JWT_SECRET` dedicado.

DoD por lote: tests verdes, verificación curl/browser en producción, sin regresión de tamaño/TTFB.

## P1 — Experiencia de valor y conversión

1. **A-06 Property Page**: similares reales (misma ciudad/provincia, precio ±30%, excluye la propia), swipe de galería en mobile, CTA sticky con safe-area.
2. **A-07 Accesibilidad WCAG AA**: targets ≥44px, focus trap en modal + drawer IA, `aria-modal`, revisión de contraste en badges.
3. **A-09 Performance**: mapa en home inicializa al entrar en viewport (IntersectionObserver), medición Lighthouse 4G antes/después.
4. **A-05a IA conectada**: ejecutar `/api/admin/embeddings/sync` en producción y cablear `/api/search/semantic` como herramienta interna de NEXO IA (el LLM decide cuándo usarla vía regla en prompt + fallback keyword actual).

## P2 — Inteligencia y growth

1. **A-05b Acciones de IA**: respuesta estructurada opcional (`{"action": "filter"|"compare"|"map"|"favorite", ...}`) ejecutada en cliente; fallback a texto si el JSON es inválido.
2. **A-13 Contexto de propiedad** en el widget (detalle/contacto pasan el inmueble actual al prompt; sanear input).
3. **A-10 Tests**: unit de semantic/JWT/images + smoke E2E del flujo search→map→property→contact.
4. **A-11 Analytics privado**: contadores agregados D1 (sin PII/cookies) + vista admin `/api/metrics`.
5. **A-12 Admin móvil 390px**: smoke test y ajustes.

## P3 — Escalado (cuando lo anterior esté estable)

1. Migración de medios a R2 (`BUCKET_IMAGENES` ya preparado) + subida desde admin.
2. Externalizar JS inline a módulos servidos con hash para endurecer CSP (quitar `unsafe-inline`).
3. Favoritos de usuario reales (tablas `users`/`user_favorites` ya existen) con registro ligero.
4. Clustering de marcadores si el inventario supera ~100 puntos visibles.

## Lo que NO se hará (descartado por FEWER+BETTER)

- Frameworks de frontend (React/Vue): rompería bundle mínimo y velocidad actual sin beneficio real a esta escala.
- Clustering complejo de mapa ahora: hay 5 propiedades; es sobreingeniería.
- Páginas SEO programáticas sin inventario real (thin content): prohibido por la propia misión.
- Multi-idioma: el mercado objetivo es Cuba; español primero.
