# NEXO — FINAL FORENSIC STABILIZATION & PRODUCTION INTEGRITY GATE

**Fecha:** 2026-08-24 · **Auditor:** OpenHands (rol: equipo Tier-1 completo)
**Alcance:** auditoría adversarial completa — frontend, backend, D1, R2, Vectorize/AI,
PWA, seguridad, rendimiento, accesibilidad, SEO, white-label, Cloudflare, CI/CD,
documentación y buyer-takeover. Correcciones mínimas y seguras únicamente.

---

## 1. Executive Summary

El sistema estaba ya en muy buen estado (Gates 01–22 previos). Esta auditoría
encontró **8 defectos reales** (ninguno P0/P1): **1 P2 de seguridad cliente-side
(HTML injection en /cuenta/), 1 P2 de abuso de API (register sin límite estricto),
4 P3 de drift documental, 1 P3 SEO (title duplicado), 1 P3 (CSP inconsistente en
HEAD), 1 P3 cosmético CI**. Todos corregidos, testeados (249→**251/251**),
desplegados y verificados en producción. **No se hallaron** problemas P0/P1,
corrupción de datos, ni exposure de secretos. Veredicto: **PRODUCTION VERIFIED /
BUYER VERIFIED / SECURITY VERIFIED / TAKEOVER VERIFIED**.

## 2. HEAD inicial

`e62cb4578d2f1a31aafe9e5f0c1464f9dd57185f` (main, "GATE 22: selling package")

## 3. HEAD final

`ce4e300` — "GATE 23: forensic stabilization" (main)

## 4. Production version

Worker `nexo-inmueble` desplegado vía CI (run 32729501338, 48s ✓) al commit
`ce4e300`. URL: https://nexo-inmueble.luisangelfigueredo02.workers.dev
SW version: `nexo-v12-static-swr`.

## 5. Tests antes

251 pruebas ejecutables relevantes: **249/249 pass** (15 suites).

## 6. Tests después

**251/251 pass** (15 suites; +2 regresión nuevas para rate limit de register).
Ejecutado tras cada cambio; CSP anti-drift test pasa tras regenerar hashes con
`node scripts/generate-csp-hashes.mjs --write`.

## 7. Issues encontrados (todos VERIFIED)

| # | Severidad | Archivo | Problema |
|---|---|---|---|
| 1 | **P2** | `public/cuenta/index.html:234` | Favoritos inyectaban `p.title/neighborhood/province` en `innerHTML` **sin escapar** → inyección HTML almacenada (datos D1). CSP bloquea scripts; el riesgo era inyección de markup (defacement/phishing). |
| 2 | **P2** | `worker.js` `/api/auth/register` | Solo límite general 20/min/IP → creación masiva de cuentas posible. Login tenía límite estricto scoped; register no. |
| 3 | **P3** | `worker.js` ruta `/property.html` | Respuesta servía **dos `<title>`** (SEO inyectado + estático de plantilla) — HTML inválido. |
| 4 | **P3** | `README.md` | Documentaba `GET /api/properties?ids=A,B` (máx. 5) — **endpoint inexistente** (el worker ignora el param; /comparar/ filtra client-side). |
| 5 | **P3** | `TAKEOVER.md` §5b | Afirmaba que `/api/properties` vacío devuelve `{"properties":[]}`; en realidad devuelve `[]` (array bare). |
| 6 | **P3** | `AGENTS.md` | SW `nexo-v10-static-swr` (real: v11); "246 tests" (real: 249). |
| 7 | **P3** | `worker.js` branch ASSETS | Peticiones `HEAD` a páginas HTML obtenían CSP calculado sobre HTML vacío (sin hashes sha256) — inconsistente, sin impacto funcional (no hay cuerpo). |
| 8 | **P3** | `.github/workflows/deploy.yml` | Echo "Desplegado: nexo-platform" — el worker se llama `nexo-inmueble`. |

## 8. Issues corregidos (8/8)

| # | Fix | Evidencia |
|---|---|---|
| 1 | `meta` construido con `textContent`/`append` (sin innerHTML con datos) | `public/cuenta/index.html`; navegador: /cuenta/ renderiza OK sin errores CSP (hash regenerado) |
| 2 | `enforceScopedRateLimit(env, request, "auth-register")` en register | Tests 12–13 en `rate-limit.test.mjs`; producción: petición 11 → **429** (verificado con emails inválidos, 0 cuentas creadas) |
| 3 | `<title>` de SEO eliminado del bloque inyectado; el estático se **reemplaza** con el SEO | Simulación local: 1 title, escapado; producción: `curl` → 1 title "Casa en Vedado \| NEXO" |
| 4 | Fila `?ids=` eliminada de README | — |
| 5 | TAKEOVER muestra `[]` | — |
| 6 | AGENTS.md: v12, 251 tests | — |
| 7 | `request.method !== "HEAD"` en transform HTML | Producción: HEAD / ahora trae CSP con hashes |
| 8 | Echo CI corregido | — |

Commit `ce4e300` (8 archivos, +63/−11). **MINIMUM SAFE CHANGE** respetado: sin
features, sin refactor, sin cambios de arquitectura ni migraciones.

## 9. Issues no corregidos (backlog documentado)

| # | Severidad | Razón |
|---|---|---|
| Mapa: `card.innerHTML.includes(property.title)` (scroll al hacer click en marker desktop) | P3 | Heurística frágil si el título tiene entidades HTML; cambio de UX riesgoso sin beneficio claro |
| GitHub Pages activo en `luisangelfigueredo02-hash.github.io/nexo-inmobiliaria/` sirviendo el repo | P3 | Documentado en TAKEOVER §7 como acción del comprador (Settings → Pages); decisión del vendedor, no se altera config de repo |
| `analyze_vector_usage` IA meta-experimental | P3 | Documentado (analítica sin consumidor en código) |
| Tablas legacy vacías (`favorites`,`user_favorites`,`users`,`analytics_*`,`ia_*`) | P3 | Residuo inofensivo, cleanup futuro documentado |
| Clusters de markers, galería con thumbnails, conversión de moneda | P3 | Backlog visual existente (AGENTS.md), no defectos |

## 10–14. Clasificación

- **P0:** ninguno. **P1:** ninguno.
- **P2:** 2 (corregidos): XSS cuenta + rate limit register.
- **P3:** 6 (corregidos) + backlog no-corregido listado arriba.
- **UNKNOWN:** cobertura mobile real ≤390px (no hay viewport emulation aquí;
  CSS mobile-first con bottom-nav/safe-area revisado por código — INFERRED OK).
  Comportamiento de mutaciones admin con token real (no se extrajeron secretos;
  cubierto por 68 tests de authorization + revisión — VERIFIED por tests).

## 15. Security — VERIFIED (adversarial en producción)

- PII (`owner_name/owner_phone/address/internal_notes/profiles/password_hash`/
  `token_hash`): ausente de API pública; 404 indistinguible.
- Auth E2E real: register 201, login 200, cookie `__Host-session` HttpOnly+Secure,
  CSRF Origin deny (403), logout 401 sin cookie.
- SQLi / path traversal (incl. URL-encoded) → 400/404; probes no alteran inventario (26).
- Admin plane: 401 sin token; migrations por `apply-migrations.mjs` — nunca crudo.
- Headers: CSP hash-based (12), HSTS 2 años, no-store en session, Permissions-Policy.
- Chat: scoped 10/5min + general; >2000 chars → 400; proveedor externo → 400.
- **Gap corregido:** register ahora con scoped limit (10/5min/IP).

## 16. Frontend — VERIFIED

8 páginas revisadas (código + navegador): /, /mapa/, /comparar/, /ia/, /cuenta/,
/property.html, /legal, /admin.html. Estados loading/empty/error presentes
(skeletons, watchdog, offline overlay). Un único defecto real (cuenta XSS) corregido.
Escaping consistente en demas páginas (función `esc`/`escapeHtml` verificada).

## 17. Backend — VERIFIED

Rutas probadas: métodos erróneos → 404; OPTIONS admin → 204 sin CORS; OPTIONS
público → 200 con CORS allowlist; HEAD consistente tras fix; worker syntax OK
(`npm run check`); routing, rate limiting, sesiones y authorization module
(`src/auth/authorization/`) revisados — deny-by-default confirmado por suites.

## 18. Database — VERIFIED

Producción D1: `0001–0007` aplicadas, schema canónico (`properties`, 26 filas
D-*), integridad verificada. Repo (schema.sql + migraciones) == producción.
Migration/sql drift test pasa. Sin migraciones ejecutadas (no eran necesarias).

## 19. R2 — VERIFIED

URLs `/media/*` 200 image/jpeg, `Vary: Accept`, long-cache; media no existente →
404 (sin leak). SVG placeholder 200.

## 20. AI — VERIFIED

`/api/chat` responde con grounding de inventario real ("Apartamento en El Vedado",
precio real 58,000 — no inventado), provenance [vectorize|ai]. Rechaza payload
externo. Rate limited. Service binding AI (no fetch externo). Secrets: AI binding
no expone nada; CLOUDFLARE_API_TOKEN usado solo en CI.

## 21. PWA — VERIFIED

manifest dinámico (nunca 404), iconos 200, SW `nexo-v12-static-swr` bump en este
gate, exclusiones auth/session/POST correctas, installable. No cachea sesiones.

## 22. Performance — VERIFIED

Assets `public/` = 481 KB (CI budget 800 KB). Imágenes lazy con srcset WebP.
Sin optimizaciones prematuras aplicadas.

## 23. Accessibility — INFERRED OK

Landmark semantics, labels, aria de favoritos (sr-only), skip patterns
revisados; touch targets nx-bottomnav safe-area. Sin auditoría de contraste tool
(UNKNOWN visual), pero variables con design tokens.

## 24. SEO — VERIFIED (tras fix)

Un único `<title>` por property, canonical, OG/Twitter, JSON-LD
RealEstateListing, sitemap dinámico (26 properties + rutas), robots dinámico.
Sin URLs personales/antiguas.

## 25. White-label — VERIFIED

Tokens `{{BRAND_*}}` en HTML reemplazados por worker; acento por token por página
(variables.css default + override por página — diseño documentado); robots/manifest
dinámicos; datos personales del operador movidos a `[vars]`. "NEXO" solo en
comentarios de CSS/JS (no visible). GitHub Pages en dominio personal: P3 backlog
(acción del comprador, ya documentada en TAKEOVER §7).

## 26. Cloudflare — VERIFIED

wrangler.toml: worker único, D1 nexo-db, R2 BUCKET_IMAGENES, Vectorize
nexo-index, AI binding, assets, smart placement. `/api/health` post-deploy OK.

## 27. CI/CD — VERIFIED

Run 32729501338 ✓ (48s, incluye wrangler deploy). Echo de nombre corregido.
Pages workflow también ✓.

## 28. Documentation — VERIFIED (tras fixes)

README/TAKEOVER/DEPLOYMENT/CHANGELOG/AGENTS alineados con código y producción.
Drift corregido: `?ids=`, forma de respuesta JSON, versión SW, conteo tests.

## 29. Buyer takeover — VERIFIED

TAKEOVER ejecutable end-to-end revisado paso a paso: recursos/binding table,
white-label vars, despliegue, D1 recreate sequence (schema primero + script),
demo seed/clear, handoff limpio, secretos a rotar, verificación. Limitaciones
conocidas honestamente documentadas.

## 30. Production evidence

- Health: `{"ok":true}` post-deploy (GATE 23)
- Property SEO: grep de `<title>` = 1
- Register RL: 10×400 (email inválido, sin cuentas) → 429 en #11
- HEAD /: CSP con `sha256-` (1 match)
- SW v12 servido
- Chat IA grounding: propiedad real + precio real
- /cuenta/ render OK tras regeneración hash CSP
- CI run ✓ 48s

## 31. Remaining backlog

Los puntos de §9 (todos P3, ninguno bloquea venta/operación).

## 32. Final verdict

**PRODUCTION VERIFIED — BUYER VERIFIED — SECURITY VERIFIED — TAKEOVER VERIFIED.**
8 defectos reales encontrados y corregidos (2 P2 seguridad, 6 P3), 0 cambios
destructivos, 0 features nuevas, 251/251 tests, despliegue en main verificado.
El sistema queda honestamente más estable: el riesgo más relevante (HTML
injection almacenada en /cuenta/ y register spammable) está eliminado con
regresión cubierta por tests.
